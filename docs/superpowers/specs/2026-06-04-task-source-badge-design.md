# Дизайн: пометка источника задачи

**Дата:** 2026-06-04  
**Статус:** Approved

## Проблема

У задачи нет индикатора откуда она пришла. При смешанном потоке (transcript, Claude MCP, ручной ввод в боте, Mini App) непонятно контекст создания задачи.

## Решение

Показывать строку провенанса `[источник] · [автор] · [дата]` — в карточке Mini App и в детальном сообщении бота.

## Архитектура

### 1. Backend — swarm-api/index.ts (GET /tasks)

После вызова `listTasks(...)`:

1. Собрать уникальные `created_by_telegram_id` (не null) из результата
2. Один батч-запрос: `supabase.from("user_profiles").select("telegram_id, first_name").in("telegram_id", ids)`
3. Построить Map `telegram_id → first_name`
4. Добавить поле `created_by_name: string | null` к каждой задаче перед отдачей в JSON

Задачи без `created_by_telegram_id` → `created_by_name: null`.  
Схема БД и `_shared/tasks/types.ts` не меняются — поле добавляется только в JSON-ответ `swarm-api`.

### 2. Frontend — miniapp

**`miniapp/src/types.ts`**  
Добавить `created_by_name: string | null` в тип `Task`.

**`miniapp/src/components/TaskCard.tsx`**  
Добавить строку провенанса под заголовком задачи.

Маппинг `source` → отображение:

| source | метка |
|--------|-------|
| `transcript` | 🎤 Transcript |
| `claude` | 🤖 Claude |
| `manual` | ✍️ Manual |
| `mini_app` | 📱 Mini App |
| прочее | без эмодзи, значение как есть |

Формат строки:
- Полный: `🎤 Transcript · Garva · 3 июн`
- Без имени: `🎤 Transcript · 3 июн`

Дата берётся из `created_at`, форматируется кратко (`3 июн` / `3 Jun` — по локали браузера).

### 3. Telegram бот — handlers.ts

В `buildTaskDetailMessage` добавить строку источника в конец текста:

```
📌 <b>Название</b>

👤 Исполнитель
📅 Дедлайн: —
🏷 Статус: Открыта
📍 Источник: 🎤 Transcript
```

`formatter.ts` (`sendTaskCard`, `sendPendingTaskCard`) — **не трогаем**, там краткий формат для потока.

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `supabase/functions/swarm-api/index.ts` | Батч-резолв `created_by_name` после `listTasks` |
| `miniapp/src/types.ts` | Добавить `created_by_name: string \| null` в `Task` |
| `miniapp/src/components/TaskCard.tsx` | Строка провенанса |
| `supabase/functions/swarm-bot/tasks/handlers.ts` | Добавить строку источника в `buildTaskDetailMessage` |

## Что не меняется

- `_shared/tasks/types.ts` — shared Task type не трогаем
- `_shared/tasks/db.ts` — `listTasks` не трогаем  
- `formatter.ts` — краткие карточки в потоке не трогаем
- MCP (`swarm-mcp`) — не трогаем
- Схема БД — не трогаем

## Граничные случаи

- Старые задачи без `created_by_telegram_id` → показывать только источник и дату, без имени
- Неизвестный source → показывать значение как есть (без эмодзи)
- Пустой список задач → батч-запрос не выполняется
