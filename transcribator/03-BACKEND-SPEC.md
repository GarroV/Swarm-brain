# 03 — Backend: таблица meetings и edge-функции

Репозиторий: `GarroV/Swarm-brain`, бэкенд — Supabase Edge Functions (Deno), прод-проект `vbqglndbxkpmreccpqmr`. Всё описанное здесь **задеплоено**. Документ сверен 1:1 с кодом; при расхождении истина — код, не этот файл.

Облачная схема (важно): транскрибация идёт **на сервере**, не на машине пользователя. Агент тупой — пишет звук и грузит аудио. Сервер сам гоняет OpenAI Whisper (`whisper-1`), сводит дорожки, генерит тезисы GPT-4o. Подробности продукта и потока — `00-OVERVIEW.md`, `10-REVISED-DESIGN.md`.

Три функции вместо одной из старого плана:

| Функция | Кто зовёт | Что делает |
|---------|-----------|------------|
| `meeting-claim` | desktop-agent (smcp-токен) | Регистрирует встречу/записавшего, выдаёт право транскрибации (`transcribe`/`defer`), сохраняет личные пометки как приватную entry |
| `meeting-ingest` | desktop-agent (только claimer) | Принимает аудио (2 дорожки) → транскрипция → сведение → GPT-4o тезисы → `draft_notes_md` → уведомление; 202 + фон |
| `swarm-api` (эндпоинты `/agent-meetings*`) | веб-сессия роя (initData / JWT) | Очередь вычитки, правка черновика, публикация (создание entry + извлечение задач) |

## 1. Таблица `meetings` (миграция `20260612000000_meetings.sql`)

Авторитетный источник по схеме — файл миграции. Additive (`create table` + индексы), существующие таблицы не трогает. Старая спека описывала `ALTER TABLE meetings ADD COLUMN ...` с придуманными полями (`meeting_uid`, `notes_md`, `owner_telegram_id`) — это **снято**, таблица создаётся целиком и поля называются иначе.

Модель данных:
- `meetings` — операционная запись встречи (транскрипт, черновик тезисов, координация claim'а).
- `entries` — тезисы как искомый артефакт. **Создаётся ТОЛЬКО при публикации** (аппрув): получает эмбеддинг, попадает в семантический поиск, изоляцию по `group_id`, приватность. До публикации черновик живёт лишь в `meetings.draft_notes_md` и в поиск **не попадает**.
- Личные пометки участника — приватная `entry` (`is_private=true`, `owner_id=он`) с `metadata.meeting_id`. **Отдельной таблицы нет.** У встречи: 1 общая entry тезисов (публикуемая) + N приватных entry-пометок.

Колонки (как в миграции):

| Колонка | Тип | Назначение |
|---------|-----|------------|
| `id` | `uuid pk default gen_random_uuid()` | первичный ключ встречи |
| `source` | `text not null default 'desktop-agent'` | продюсер записи (`desktop-agent` \| будущие) |
| `identity_kind` | `text check (calendar\|room\|manual)` | вид ключа идентичности |
| `identity_key` | `text not null` | ключ дедупа реальной встречи |
| `title` | `text` | название (из календаря, если есть) |
| `started_at` / `ended_at` | `timestamptz` | время встречи |
| `attendees` | `jsonb default '[]'` | участники из календаря |
| `recorders` | `jsonb default '[]'` | `[{telegram_id, claimed_at, role}]` — кто реально записал |
| `claim_owner` | `bigint → allowed_users(telegram_id)` | кто транскрибирует |
| `lease_expires_at` | `timestamptz` | TTL claim'а (перехват, если claimer сорвался) |
| `transcript` | `jsonb` | `{language, model, segments:[{start,end,text}]}` |
| `draft_notes_md` | `text` | сгенерированные тезисы (черновик до публикации) |
| `notes_edited_at` | `timestamptz` | человек правил черновик → не перегенерировать |
| `entry_id` | `uuid → entries(id) on delete set null` | запись в базе (после публикации) |
| `group_id` | `text → workspaces(id)` | воркспейс; **резолвится из токена владельца, НЕ из payload** |
| `status` | `text default 'awaiting_review' check (awaiting_review\|in_base)` | стадия |
| `agent_version` | `text` | версия агента |
| `created_at` / `updated_at` | `timestamptz default now()` | служебное |

Дедуп: `unique index meetings_identity_key_uq on (identity_key) where identity_kind <> 'manual'`. Точные ключи (`calendar`/`room`) схлопываются автоматически; `manual` (Telegram/кнопка) уникален сам и авто-дедупу не подлежит — дубли ловятся ручным «Объединить» в вебе.

Индексы: `idx_meetings_status`, `idx_meetings_group`, `idx_meetings_entry` (partial), `idx_meetings_recorders` (GIN по `recorders`). Доступ к Data API — `grant select, insert, update, delete on meetings to service_role`.

## 2. Аутентификация агента (`_shared/agent-auth.ts`)

Никакого статического общего секрета (старый `SWARM_AGENT_SECRET` **снят**). Агент аутентифицируется персональным `smcp_`-токеном — тем же, что выдаёт бот (`/mytoken`, TTL 90 дней).

`verifyAgentToken(supabase, req)`:
1. Берёт `Authorization: Bearer <token>`.
2. Считает `sha256-hex` токена.
3. Ищет `allowed_users.claude_mcp_token_hash`, читает `telegram_id`, `group_id`, `claude_mcp_token_expires_at`.
4. Истёкший токен → `401`.
5. Возвращает `AgentIdentity = { telegramId, groupId }`.

Личность **и** воркспейс берутся из токена, а не из тела запроса — это закрывает спуфинг `owner_telegram_id` (которого в новой модели вообще нет). Ошибки — через `AgentAuthError(401, message)`.

## 3. `meeting-claim` — шаг ДО транскрибации

`POST /functions/v1/meeting-claim`, `Authorization: Bearer <smcp_токен>`, тело — JSON.

```jsonc
{
  "identity_kind": "calendar",        // calendar | room | manual
  "identity_key": "<iCalUID>:2026-06-13",
  "started_at": "2026-06-13T14:00:00+03:00",  // опц.
  "ended_at":   "2026-06-13T14:47:00+03:00",  // опц.
  "title": "Синк по Болгарии",        // опц.
  "attendees": [{ "name": "Маша", "email": "m@team.com" }], // опц.
  "user_notes": [{ "ts": 312, "text": "уточнить срок поставки" }], // опц.
  "agent_version": "0.1.0"            // опц.
}
```

Логика:
1. `verifyAgentToken` → `{ telegramId, groupId }`. Нет `groupId` → `403`.
2. Валидация тела (ручная, без zod): `identity_kind ∈ {calendar,room,manual}`, `identity_key` непустой, `user_notes[].text` — строка.
3. Разрешение записи:
   - **`manual`** — без дедупа, всегда новая встреча, `claim_owner = telegramId`, `decision = transcribe`.
   - **`calendar`/`room`** — пробуем `insert` как claimer. Успех → `transcribe`. Конфликт `23505` (уникальный индекс) → встреча уже есть: атомарным условным `update` (`transcript is null AND (claim_owner is null OR lease_expires_at < now)`) пытаемся перехватить lease. Перехватили → `transcribe`, иначе → `defer`.
4. `registerRecorder` — добавляет `{telegram_id, claimed_at, role}` в `meetings.recorders` (read-modify-write; дубль того же `telegram_id` не пишем).
5. Личные пометки (`user_notes`) → `savePersonalNotes`: склейка `[mm:ss] текст`, эмбеддинг (`text-embedding-3-small`), приватная `entry` (`is_private=true`, `owner_id=telegramId`, `source=desktop-agent`, `entry_type=meeting_note`, `metadata.meeting_id`, `metadata.kind=personal_notes`). Идемпотентно: повторный claim **обновляет** ту же entry. Сбой пометок — best-effort, координацию транскрибации не валит.

Ответ: `{ meeting_id, decision: "transcribe"|"defer", lease_ttl_sec: 1800 }`.

`decision=defer` → агент аудио **не грузит** (его уже пишет/зальёт claimer). Lease 30 мин: если claimer сорвался и транскрипта нет, следующий claim перехватит право.

## 4. `meeting-ingest` — заливка аудио (только claimer)

`POST /functions/v1/meeting-ingest`, `Authorization: Bearer <smcp_токен>`, `multipart/form-data`:

| Поле | Обяз. | Назначение |
|------|-------|------------|
| `meeting_id` | да | id встречи из ответа claim |
| `audio` | да | системный звук (удалённые участники), AAC m4a, ≤ 25 МБ |
| `audio_mic` | нет | микрофон владельца записи, AAC m4a, ≤ 25 МБ |

Лимит 25 МБ — ограничение эндпоинта транскрибации OpenAI. Длинные встречи режем/жмём на стороне рекордера (**TODO**, см. `10-REVISED-DESIGN.md`). `audio_mic` ≤ 1024 байт игнорируется (считаем пустым).

Синхронная часть (до ответа):
1. `verifyAgentToken`.
2. Парсинг multipart, валидация полей и размеров.
3. Читаем `meetings` по `meeting_id`. Нет → `404`.
4. **Только claimer:** `m.claim_owner !== identity.telegramId` → `403`.
5. **Защита правок человека:** `notes_edited_at != null` → пропуск (`summary_status: "skipped_human_edit"`), ничего не перетранскрибируем.
6. Читаем аудио в память, ставим фоновую задачу `processAudio`.
7. Ответ **202** `{ ok, meeting_id, web_url, summary_status: "processing" }`. Фон — через `EdgeRuntime.waitUntil` (нет рантайма → `await` синхронно).

Фоновая часть (`processAudio`):
1. Транскрибируем системную дорожку: `POST /v1/audio/transcriptions`, `model=whisper-1`, `response_format=verbose_json`, `language=ru` → сегменты `{start,end,text}`, помечаем `speaker="собеседник"`.
2. Если есть микрофон — транскрибируем вторую дорожку, помечаем `speaker="я"`, `model="whisper-1+mic"`.
3. **Сведение по таймстампам:** сортируем все сегменты по `start` → восстанавливаем порядок реплик. Пишем `meetings.transcript = {language, model, segments}`.
4. Тезисы: `chatComplete` к `gpt-4o` (`max_tokens=3000`) с системным промптом `TEZIS_SYSTEM` (тезисы строго по стенограмме, темы называть широко — «Персонал», «IT / Технические проблемы» и т.п.; реплики помечены «собеседник»/«я»). Текст транскрипта обрезается до 100k символов.
5. Пишем `meetings.draft_notes_md`.
6. Уведомление: `sendTelegram` каждому из `recorders` — «📝 Тезисы встречи готовы к вычитке», inline-кнопка **Открыть** на `WEB_BASE_URL/?meeting=<id>` (если `WEB_BASE_URL` задан; на проде `https://swarm-brain.pages.dev`).

Транскрибируем **один раз** (claimer-only + 202/фон страхуют от дублей и от повторных retry агента). Тезисы генерим из транскрипта; эмбеддинг на этом шаге **не** считается (он появляется только при публикации — см. §6).

Секреты функции: `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WEB_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 5. Вычитка и правка черновика (`swarm-api`)

Аутентификация `swarm-api` — **веб-сессия роя**: `Authorization: tma <initData>` (Mini App) или `Authorization: Bearer <JWT>` (веб, httpOnly cookie через CF Pages Function). Не agent-токен. Воркспейс резолвится из `allowed_users.group_id`.

- `GET /agent-meetings?status=awaiting_review|in_base` — очередь вычитки / опубликованные. Видны записи своего воркспейса, где caller среди `recorders` (`q.contains("recorders", [{telegram_id}])`) или caller — админ. Поля: `id, title, source, identity_kind, started_at, ended_at, status, draft_notes_md, recorders, entry_id, created_at`. `status` по умолчанию `awaiting_review`.
- `GET /agent-meetings/:id` — полный черновик (транскрипт + тезисы + участники). Доступ — только записавшие или админ; иначе `404`.
- `PATCH /agent-meetings/:id` — правка `draft_notes_md`. Ставит `notes_edited_at = now()` (после этого `meeting-ingest` черновик не перетранскрибирует). Если `status=in_base` → `409` («Уже опубликовано — правьте запись в базе»).

## 6. Публикация: `POST /agent-meetings/:id/publish`

Аппрув + выбор базы. Тело `{ base: "workspace" | "personal" }` (`personal` → приватная запись).

1. Идемпотентность: уже `in_base` и есть `entry_id` → возвращаем существующую entry.
2. Нет `draft_notes_md` → `400` («Тезисы ещё не готовы»).
3. **Эмбеддим тезисы** (`draft`, не весь транскрипт): `text-embedding-3-small`, `input` обрезается до 8000 символов.
4. Создаём `entries`: `content=draft`, `summary=draft`, `embedding`, `source="desktop-agent"`, `entry_type="transcript"`, `metadata={meeting_id, title, confirmed:true}`, `entry_date` из `started_at`, `group_id`, `is_private` и `owner_id` по выбору базы (`personal` → `is_private=true`, `owner_id=telegram_id`).
5. **Привязка с гонка-гардом:** `update meetings set entry_id, status='in_base' where id=:id and entry_id is null`. Если кто-то опубликовал параллельно (`linked` пустой) — удаляем свой дубль entry, возвращаем уже привязанную запись.
6. **Авто-извлечение задач** `createMeetingTasks(draft, {groupId, createdBy, meetingId, isPrivate})`:
   - `gptExtractTasks` — `gpt-4o-mini`, structured JSON `[{title, description, assignee, due_date, country}]`, до 15 задач.
   - `buildNameResolver` — резолв исполнителя по имени среди членов команды (`user_profiles`).
   - `createTask(..., source="transcript", meeting_id, confirmed:true)` с наследованием приватности (`personal` → `is_private=true`, `owner_id=createdBy`).
   - Сбой извлечения **не валит** публикацию (entry уже создан) — ошибка только логируется.

Ответ: `201` с созданной entry (или `200` с существующей при идемпотентном/гоночном пути).

После публикации встреча уходит из очереди вычитки разом у всех записавших (`status` сменился на `in_base`).

## 7. Source-фильтры: `desktop-agent` видна в трёх местах

Чтобы записи нового источника соседствовали с Read.ai (выключаем в конце месяца) и Granola (пока работает), `desktop-agent` добавлен в фильтры встреч:

| Место | Файл | Фильтр |
|-------|------|--------|
| swarm-api `GET /meetings` | `swarm-api/index.ts` | `.in("source", ["read_ai","granola","desktop-agent"])` |
| MCP `get_meetings` | `swarm-mcp/index.ts` | `.in("source", ["read_ai","granola","desktop-agent"])` |
| бот `rai_saved` (последние встречи) | `swarm-bot/handlers/meetings.ts` | `source.in.(read_ai,voice,desktop-agent)` |

## 8. Тесты и проверки

- claim `calendar`/`room`: первый получает `transcribe`, второй (тот же ключ, lease активен) — `defer`. После протухания lease без транскрипта — следующий перехватывает.
- claim с `user_notes` → создаётся приватная entry владельца; повторный claim не плодит копии (update той же entry).
- ingest не от claimer → `403`. Аудио > 25 МБ → `413`. Пустое `audio` → `400`.
- ingest после ручной правки (`notes_edited_at != null`) → `summary_status: "skipped_human_edit"`, транскрипт/черновик не тронуты.
- publish: первый — `201` с новой entry + извлечённые задачи; повторный — `200` с той же entry, дублей нет (гонка-гард). `base=personal` → entry и задачи приватные.
- Невалидный/истёкший токен на claim/ingest → `401`.

`deno check` затронутых функций перед деплоем (pre-commit hook). Деплой: `supabase functions deploy meeting-claim`, `... meeting-ingest`, `... swarm-api` (функции с `_shared/` — только через CLI, не через MCP deploy). Секреты — `supabase secrets set`.
