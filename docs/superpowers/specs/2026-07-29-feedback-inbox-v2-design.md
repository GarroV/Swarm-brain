# Feedback Inbox v2 — Design

**Date:** 2026-07-29
**Status:** Approved (owner waived spec review — proceed to implementation)
**Branch:** `feat/feedback-inbox-v2` (worktree `../swarm-feedback`)

## Problem

Фидбек уже собирается (бот `/feedback` + веб-форма в настройках → таблица `feedback` + пост в Telegram-канал). Но:

1. Кнопка «✅ Прочитано» в канале **физически удаляла строку** из `feedback` → ничего не копится.
2. Таблица плоская: нет статуса, категории, источника, связи с задачей.
3. Скрин хранится как Telegram `file_id` — не ссылка, читается только ботом, для внешнего разбора невидим. В вебе скринов нет вообще.
4. Владелец пересылает фидбек в Claude вручную. Хочет: фидбек копится, Claude сам его вытаскивает и разбирает.

## Decisions (согласовано с владельцем)

- **Модель:** persistent inbox + pull. `feedback` — источник правды и точка доступа Claude. Telegram-канал — пассивный пинг.
- **Категории:** фиксированный enum, выбор из списка (веб — дропдаун, бот — компактная клавиатура). `source` (bot/web) хранится отдельно, поэтому в категориях его нет.
- **Скрины:** хранить в Supabase Storage `swarm_drive` (durable public URL). Паритет бот+веб. Регулярная чистка.
- **Канал:** кнопку «Прочитано» **убрать совсем**. Статусами рулит Claude через SQL/MCP. Разрушающий delete уходит.
- **Веб:** плавающая иконка фидбека в углу (вопросик) открывает форму — чтобы не лезть в панель настроек.

### Enum категорий (11)

`recorder`, `meetings`, `search`, `tasks`, `knowledge`, `digest`, `auth`, `integrations`, `claude`, `ui`, `other`

## Schema (только ADD COLUMN — безопасно)

К существующей `public.feedback`:

| Колонка | Тип | Default | Смысл |
|---|---|---|---|
| `status` | text | `'new'` | `new` → `triaged` → `done` / `wontfix` |
| `category` | text | `'other'` | enum выше |
| `source` | text | `'bot'` | `bot` / `web` |
| `screenshot_url` | text | null | durable URL в `swarm_drive` |
| `task_id` | uuid | null | если превращён в задачу |
| `resolved_at` | timestamptz | null | когда закрыт |

`photo_file_id` остаётся (не трогаем; канон скрина теперь `screenshot_url`). Мигрируем и `00_base_schema.sql`, и новый файл `supabase/migrations/`.

## Ingest

### Бот (`swarm-bot/handlers/feedback.ts`)

`/feedback` → `feedback_text` → текст → **выбор категории** (клавиатура, callback `fbcat_<cat>`; кладём `{text, category}` в сессию `feedback_photo`) → «скриншот?» → фото **или** «готово».
Фото: `getFile` → скачать байты → `swarm_drive` upload → `screenshot_url`. INSERT `status='new', source='bot', category, screenshot_url`. Пост в канал (без кнопки).

### Веб (`swarm-api` `POST /feedback` + miniapp)

Форма: **дропдаун категории** + **загрузка файла** (input). Скрин грузится в `swarm_drive` (существующий upload-путь swarm-api). INSERT `status='new', source='web', category, screenshot_url`. Пост в канал (без кнопки).
Плавающая кнопка в вебе открывает ту же форму (общий компонент `FeedbackForm`).

## Channel (пинг)

Пост = текст + скрин (если есть), **без inline-кнопки**. Legacy-кнопка `fb_read_` в уже опубликованных сообщениях: хендлер переводим на `status='read'` (не delete) — безопасно для старых сообщений, разрушающего удаления больше нет.

## Access (pull)

- **Claude Code:** читаю `feedback` напрямую (SQL), фильтр по `status`/`category`.
- **Claude Desktop (MCP, `swarm-mcp`):**
  - `get_feedback({ status?, category?, limit? })` → список (id, text, category, source, username, created_at, screenshot_url, status).
  - `resolve_feedback({ id, status, task_id? })` → перевод статуса (+ линк на задачу). Мутация — только владелец/админ (как весь MCP).
- **Цикл:** `get_feedback status=new` → группировка по категориям → дедуп → нужное завожу задачами (проставляю `task_id`) → `done`.

## Storage cleanup

- При `done`/`wontfix`/удалении фидбека — удалять `screenshot_url` из `swarm_drive` (паттерн уже есть в swarm-api при удалении entry).
- Retention-крон: удалять resolved-фидбек (`done`/`wontfix`) старше 90 дней вместе со скрином. Реализация — pg_cron → swarm-bot `{feedback_retention_cron:true}` (по образцу `daily_report_cron`).

## Callback / session prefixes (новые)

| Prefix | Тип | Файл |
|---|---|---|
| `fbcat_<cat>` | callback (выбор категории) | `handlers/feedback.ts` |
| `feedback_text`, `feedback_photo` | session | `handlers/feedback.ts` (существуют) |

## Files

| Файл | Изменение |
|---|---|
| `supabase/migrations/<ts>_feedback_inbox_v2.sql` | ADD COLUMN ×6 |
| `supabase/schema/00_base_schema.sql` | синк таблицы `feedback` |
| `swarm-bot/handlers/feedback.ts` | шаг выбора категории, скрин→swarm_drive, статус вместо delete |
| `swarm-bot/index.ts` | новый callback `fbcat_` (диспатч уже через `handleFeedbackCallbacks`) |
| `swarm-api/index.ts` | `POST /feedback`: приём `category` + скрина (URL), `source='web'` |
| `swarm-mcp/index.ts` | tools `get_feedback` / `resolve_feedback` |
| `miniapp/src/lib/api.ts` | `sendFeedback(text, category, file?)` |
| `miniapp/src/components/.../FeedbackForm.tsx` | общий компонент формы |
| `miniapp/src/components/roy/...` | плавающая кнопка фидбека (глобально в layout) |
| `miniapp/src/components/SettingsScreen.tsx` | переиспользовать `FeedbackForm` |
| `docs/ARCHITECTURE.md`, `docs/QUICK_REF.md`, `docs/BACKLOG.md` | инвентари/индекс |

## Verification

- `deno check` затронутых edge-функций; `npm run build` в `miniapp/`.
- Смоук реального флоу: бот `/feedback` с категорией+скрином; веб — плавающая кнопка → форма; проверить строку в `feedback` (status/category/source/screenshot_url) и пост в канал без кнопки.
- **Caveat:** в этой сессии Supabase MCP не авторизован → миграцию на прод и `execute_sql`-смоук применяет владелец (или через CLI). Раскатка на команду — только после подтверждения на реальном окружении (prod-правило проекта).

## Out of scope

- Второй дропдаун `kind` (bug/idea) — тип определяю из текста при разборе.
- Digest-крон со сводкой по темам — можно добавить позже поверх той же таблицы.
- Автозаведение задач из фидбека — превращаю осознанно при разборе, не автоматом.
