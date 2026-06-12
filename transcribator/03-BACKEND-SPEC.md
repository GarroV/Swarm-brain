# 03 — Backend: edge-функция meeting-ingest и БД

Репозиторий: `GarroV/Swarm-brain`. Новая функция кладётся в `supabase/functions/meeting-ingest/`. Образец структуры и стиля — существующая `read-ai-webhook` (изучить ПЕРЕД написанием кода: переиспользовать хелперы записи в базу знаний, эмбеддингов, создания задач, отправки сообщений ботом).

## 1. Изменения схемы БД (миграция)

Точные имена таблиц сверить с реальной схемой проекта. Ожидаемые изменения (адаптировать под существующие таблицы meetings/entries/tasks):

```sql
-- К таблице встреч (или создать, если read-ai писал прямо в entries)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_uid uuid UNIQUE;       -- meeting_id от агента
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS source text DEFAULT 'read-ai'; -- 'desktop-agent' | 'read-ai'
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript jsonb;              -- segments как есть
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS user_notes jsonb;              -- пометки пользователя
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS notes_md text;                 -- тезисы (markdown)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS notes_edited_at timestamptz;   -- NULL = человек не правил
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner_telegram_id bigint;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS agent_version text;
```

Секрет: `SWARM_AGENT_SECRET` в секретах Supabase (`supabase secrets set`).

## 2. Логика функции (псевдокод)

```ts
serve(async (req) => {
  // 1. Auth
  if (req.headers.get("authorization") !== `Bearer ${SWARM_AGENT_SECRET}`) return 401;

  // 2. Валидация payload (zod или ручная): meeting_id, started_at, transcript.segments обязательны
  const p = await validate(req.json());

  // 3. Upsert встречи по meeting_uid
  const existing = await db.meetings.findByUid(p.meeting_id);
  const humanEdited = existing?.notes_edited_at != null;

  // 4. Генерация тезисов (если не humanEdited)
  let notesMd = existing?.notes_md;
  if (!humanEdited) {
    notesMd = await generateSummary(p.transcript, p.user_notes, p.title, p.attendees);
  }

  // 5. Запись: meetings upsert + entry в базу знаний (как read-ai-webhook)
  // 6. Экстракция задач из notesMd (переиспользовать механизм read-ai-webhook),
  //    привязка задач к встрече. При повторной отправке задачи НЕ дублировать
  //    (сверка по тексту/хешу или пересоздание только новых).
  // 7. Эмбеддинги: notesMd целиком + транскрипт чанками по ~800 токенов
  //    (text-embedding-3-small, как везде в проекте)
  // 8. Уведомление: sendTelegramMessage(p.owner_telegram_id, ..., inline-кнопка web_url)
  // 9. Ответ 200 по контракту 02-API-CONTRACT.md
});
```

Если генерация тезисов часовой встречи рискует упереться в таймаут edge-функции — разбить на два шага: meeting-ingest быстро сохраняет и ставит job (таблица-очередь + pg_cron / `EdgeRuntime.waitUntil`), генерацию делает фоновый обработчик. Начать с синхронного варианта, мерить.

## 3. Промпт генерации тезисов

Хранить как константу/шаблон в коде функции (одно место правки для всей команды). Структура промпта:

```
СИСТЕМА:
Ты делаешь тезисы встречи для командной базы знаний. Язык — русский.
Формат (markdown):
## Контекст        (1-2 предложения: о чём встреча)
## Ключевые решения (буллеты, конкретно: кто/что/когда)
## Обсуждение       (сжатые тезисы по темам)
## Задачи           (- [ ] @Исполнитель: задача — срок), если есть
## Открытые вопросы (если есть)
Не выдумывай. Если в транскрипте чего-то нет — не пиши.

ПОЛЬЗОВАТЕЛЬ:
Название: {title}; Участники: {attendees}
{ЕСЛИ user_notes:}
Пометки участника во время встречи (его акценты — обязательно раскрой каждую,
найдя контекст в транскрипте рядом с указанным временем):
{ts → text список}
Транскрипт (с таймстампами):
{segments}
```

Сопоставление пометка↔транскрипт: для каждой пометки включать в промпт явное окно транскрипта ±120 сек вокруг `ts` пометки (пометить как «контекст пометки»), плюс полный транскрипт. Для очень длинных встреч (>1.5ч) — транскрипт можно сжимать предварительным проходом, но НЕ в MVP.

Экстракция задач: использовать существующий механизм проекта (как из Read.ai). Если его нет в переиспользуемом виде — второй LLM-вызов со structured output (JSON: `[{assignee, text, due}]`).

## 4. Endpoint сохранения правок из Web Editor

Либо отдельная функция, либо прямой Supabase client из Next.js с RLS. Минимум:

```
PATCH meetings SET notes_md = $1, notes_edited_at = now() WHERE meeting_uid = $2
→ после сохранения: пере-эмбеддинг notes_md (старые векторы тезисов заменить),
  пере-экстракцию задач НЕ делать автоматически (правки текста ≠ новые задачи),
  дать кнопку "Обновить задачи из тезисов" для явного вызова.
```

## 5. Тесты

- curl-сценарий с фикстурой реального русского транскрипта (15 мин) — проверка end-to-end.
- Повторный POST того же meeting_id → запись одна, задачи не задвоились.
- POST после ручной правки → notes_md не тронут, `summary_status: skipped_human_edit`.
- Невалидный токен → 401. Пустой user_notes → нормальные тезисы.
