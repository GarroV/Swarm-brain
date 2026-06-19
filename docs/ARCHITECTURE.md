# Swarm Brain — Architecture

> **Для Claude Code:** Читай этот файл в начале КАЖДОЙ сессии перед тем как трогать код. После любых изменений — обновляй соответствующие разделы сразу.

## Стек

- **Runtime:** Deno (Supabase Edge Functions)
- **БД:** Supabase Postgres + pgvector
- **AI:** OpenAI GPT-4o-mini (chat) + text-embedding-3-small (поиск)
- **Bot:** Telegram Bot API (webhook)
- **Источники встреч:** Granola API, Read.ai (webhook)

---

## Edge Functions

| Функция | Триггер | Назначение |
|---------|---------|-----------|
| `swarm-bot` | Telegram webhook POST | Главный бот — весь пользовательский флоу |
| `swarm-bot` (`granola_poll`) | Cron (каждый час) | Импортирует новые заметки Granola как черновики `confirmed:false` (видны в вебе «на согласовании» + Telegram-ревью). Заменил standalone `granola-poller` |
| `granola-poller` | ⚠️ выведен из крона | Устаревшая standalone-функция: только слала уведомление в Telegram, в БД ничего не клала. Логика переехала в `swarm-bot` (`ingestNewGranolaNotesAllUsers`) |
| `read-ai-webhook` | Webhook от Read.ai | Принимает завершённые встречи, сохраняет в `entries`, уведомляет бота |
| `read-ai-auth` | HTTP redirect (OAuth) | OAuth callback для авторизации Read.ai, сохраняет токен в `app_settings` |
| `swarm-mcp` | MCP (Claude Desktop) | MCP-сервер для Claude Desktop: поиск, добавление знаний, управление задачами |
| `swarm-setup` | HTTP GET (публичный) | Отдаёт bash-скрипт авто-подключения Claude Desktop (macOS). Юзер запускает его через `/setup` в боте: `curl -fsSL …/swarm-setup \| SWARM_TOKEN=… bash`. Скрипт ставит Node в `~/.swarm-brain` (без sudo), мёржит блок `swarm-brain` (mcp-remote, абсолютный путь к node) в `claude_desktop_config.json`, рестартит Claude. Без секретов. Текст скрипта — `swarm-setup/script.ts` |
| `meeting-claim` | HTTP POST (desktop-agent) | Swarm Meetings: claim/lease до транскрибации (кто транскрибирует), регистрация записавших, личные пометки → приватная entry. Auth — персональный токен |
| `meeting-ingest` | HTTP POST (desktop-agent) | Swarm Meetings: приём **аудио** от claimer (multipart: `sys_parts`/`mic_parts` — JSON-манифест `[{name,offset}]` + файлы `sys_0,sys_1,…`/`mic_0,…`; **длинные дорожки рекордер режет на части ≤25 МБ**, сервер транскрибирует ограниченно-параллельно и сводит по `offset`; старый одиночный `audio`/`audio_mic` поддержан как фолбэк) → транскрибация (OpenAI Whisper, ретраи 429/5xx) → async-генерация тезисов в `meetings.draft_notes_md` + **авто-название** по сути встречи (если заголовок пуст/плейсхолдер «Запись <дата>») → уведомление записавшим. `summary_status` (`processing`/`done`/`failed`): идемпотентность повторного upload + видимость сбоя (на `failed` — Telegram записавшим). Auth — персональный токен. Вычитка: `swarm-api` `GET/PATCH/DELETE /agent-meetings/:id` (PATCH правит `draft_notes_md` и/или `title`, DELETE — до публикации) + `POST /agent-meetings/:id/publish` |

**Деплой:** `supabase functions deploy <name> --no-verify-jwt` (обязательно `--no-verify-jwt` для Telegram webhook)

---

## Общий движок задач — _shared/tasks/

Единый слой доступа к таблице `tasks`, не деплоится Supabase как функция.

```
supabase/functions/_shared/tasks/
├── types.ts        # Task, TaskInput, Sprint, TaskDependency, DependencyType — единственный источник типов
├── db.ts           # createTask / getTask / listTasks / updateTask / deleteTask
├── sprints.ts      # listSprints / createSprint / updateSprint / deleteSprint / setTasksSprint (Рой)
└── dependencies.ts # listDependencies / createDependency (цикл-детекция) / deleteDependency (Рой)
               # Принимает готовый group_id и готовых исполнителей.
               # НЕ резолвит имена и НЕ ищет workspace — это делают прослойки клиентов.
               # Бросает исключение при ошибке.
```

**Контракт `_shared/tasks/db.ts`:**

| Функция | Поведение |
|---------|-----------|
| `createTask(input, groupId?)` | insert всеми колонками (+ `confirmed` дефолт `false`, `created_by_telegram_id` дефолт `null`, поля Роя `is_private`/`owner_id`/`start_date`/`timeline_position`/`sprint_id`), `.select().single()`, статус дефолт `"open"`, теги дефолт `[]` |
| `getTask(id)` | `.maybeSingle()` |
| `listTasks(filters, groupId?)` | `select *`, order `due_date asc nullsFirst:false`; по умолчанию исключает `done/cancelled/draft`; фильтры: `status`, `country`, `telegramId`, `assigneeText`, `confirmed`, `createdBy`, `dueToday`, `sprintId`, `tags` (overlaps/ANY), `start_date`/`due_date` range (пост-фильтр `assigneeText`); **visibility приватности**: если не `isAdmin` — приватные задачи видны только владельцу (`is_private=false OR owner_id=viewerId`); без `viewerId` fail-closed → только публичные |
| `updateTask(id, fields)` | `update {...fields, updated_at}` |
| `deleteTask(id)` | сначала `task_history`, потом `tasks` |

**Прослойки клиентов** (различия живут здесь, не в движке):

| Клиент | Файл | Что делает поверх движка |
|--------|------|--------------------------|
| swarm-mcp | `swarm-mcp/tasks/tools.ts` | резолвит `requesting_user_id → group_id` (обязателен для get/delete/update); воркспейс-изоляция: `task.group_id === groupId` проверяется в delete/update; резолвит `assignee_name` через fuzzy-матч; форматирует `Task[]` в строку для Claude; при `add_task` устанавливает `confirmed: false`, `created_by_telegram_id`, отправляет Telegram-уведомление создателю через `notifyCreator` |
| swarm-bot | `swarm-bot/tasks/db.ts` | тонкая обёртка, пробрасывает вызовы; `dbListAllOpen`, `dbListPending`, `dbListToday` остаются локальными (собственная логика сортировки/фильтрации); **все командные листинги фильтруют `is_private=false`** — личные задачи (Рой) видны только в miniapp у владельца, не текут в командный бот (`dbListAllOpen`, pending/done/export в `handlers.ts`, список по юзеру в `users.ts`, счётчики в `index.ts`); `handlers.ts` при создании задачи (addtask wizard + `analyzeAndCreateTasks`) всегда передаёт `confirmed: false, created_by_telegram_id: userId`; при завершении wizard (`addtask_due`) устанавливает `confirmed: true` и вызывает `broadcastTaskAssigned` |

**Прямые запросы к `tasks` минуя движок** (известный остаток, отдельный этап):
- `handlers.ts` ~626, 632, 643 — `tl_pending`, `tl_done`, `tl_export` callbacks
- `index.ts` swarm-bot ~326–327 — `smartTaskSearch`

---

## swarm-bot — структура файлов

```
supabase/functions/swarm-bot/
├── index.ts                 # Entry point: роутинг команд, callback-ов, сессий
├── handlers/
│   ├── granola.ts           # Granola: импорт/превью/сохранение встреч
│   ├── meetings.ts          # Read.ai + saved meetings: просмотр, подтверждение, редактирование
│   ├── knowledge.ts         # /add, /ask — добавление и поиск по базе знаний
│   ├── manage.ts            # Правка/удаление записей из чата (поиск→подтверждение→действие, kb*-коллбеки)
│   ├── media.ts             # Голос, документы, фото, URL — парсинг и сохранение
│   ├── digest.ts            # /digest — персональный дайджест за период
│   ├── users.ts             # /users — управление командой (allow/block)
│   ├── workspace.ts         # /workspace — управление воркспейсами (суперадмин, CLI)
│   ├── superadmin.ts        # /superadmin — интерактивная inline-панель (ADMIN_USER_ID only)
│   └── help.ts              # /help — текст справки
├── tasks/
│   ├── index.ts             # Экспорт task-хендлеров
│   ├── handlers.ts          # Callback/session обработка для задач
│   ├── db.ts                # Тонкая обёртка над _shared/tasks/db.ts + dbListAllOpen
│   ├── formatter.ts         # Форматирование задач для Telegram
│   ├── matcher.ts           # NLP-определение intent, fuzzy assignee matching (findUserByMention)
│   └── types.ts             # Реэкспорт из _shared/tasks/types.ts
└── lib/
    ├── supabase.ts          # Supabase client + ADMIN_USER_ID
    ├── openai.ts            # chatComplete(), getEmbedding()
    ├── telegram.ts          # sendMessage(), sendInlineMessage(), editInlineMessage(), answerCallback()
    ├── storage.ts           # getSession/setSession/clearSession, saveEntry, checkAllowed, visibilityFilter, buildEntryIndex, getManageableEntry/updateEntryContent (правка/удаление)
    ├── intent.ts            # classifyEntryCommand/parseManageCommand (удали/замени запись), extractUrl — чистые, тестируемые (intent_test.ts)
    ├── readai.ts            # Read.ai API client + токен-рефреш
    ├── drive.ts             # Google Drive интеграция (если используется)
    ├── workspace.ts         # getUserGroupId(), checkAllowedWithGroup(), CRUD воркспейсов
    ├── name-aliases.ts      # generateNameAliases() — автогенерация алиасов имён
    └── types.ts             # TgMessage, TgCallbackQuery и др.
```

---

## Таблицы БД

| Таблица | Назначение | Ключевые поля |
|---------|-----------|---------------|
| `workspaces` | Воркспейсы (тенанты) | `id` (TEXT PK), `name` TEXT, `allowed_markets text[]` (NULL = глобальный список), `created_at` |
| `entries` | База знаний — все записи | `id`, `content`, `summary`, `embedding`, `source` (канал: `telegram`\|`granola`\|`read_ai`\|`desktop-agent`\|`link`\|`note`\|`voice`\|`file`\|…), `added_by`, `metadata` (jsonb), `countries` (включает `"General"` для общекомандных/многострановых записей), `entry_type` **CHECK `meeting`\|`note`** — два типа: встреча (транскрипт/тезисы созвона) и заметка (всё остальное). Ссылка/файл — это **фасеты заметки** через `metadata` (`url` / `file_name`+`file_type`), НЕ отдельные типы. Граница встреча↔заметка — по `entry_type`, не по source. `entry_date`, `is_private`, `owner_id`, `group_id` (FK → `workspaces.id`). Старый тип до миграции — в `metadata.legacy_entry_type` |
| `tasks` | Задачи команды + личные (Рой) | `id`, `title`, `assignees`, `due_date`, `status`, `tags`, `meeting_id`, `created_by_telegram_id`, `created_by_name`, `group_id` (FK → `workspaces.id`); модуль Рой: `is_private`, `owner_id` (FK → `allowed_users`), `start_date`, `timeline_position`, `sprint_id` (FK → `sprints`) |
| `sprints` | Спринты (Рой) | `id`, `group_id` (FK → `workspaces.id`), `name`, `start_date`, `end_date`, `status` (`planned`\|`active`\|`completed`), CHECK `start_date<=end_date` |
| `task_dependencies` | Зависимости задач (Рой) | `id`, `task_id`, `depends_on_id` (оба FK → `tasks`), `dependency_type` (`blocks`\|`relates_to`\|`duplicates`); цикл-детекция через `get_all_dependencies()` |
| `task_history` | История изменений задач | `task_id`, `changed_at`, `changes` |
| `meetings` | Swarm Meetings — источник истины о встрече (НЕ путать с `entries`) | `id`, `source` (`desktop-agent`), `identity_kind`/`identity_key` (дедуп: calendar/room/manual, UNIQUE кроме manual), `transcript` (jsonb), `draft_notes_md` (черновик тезисов до публикации), `notes_edited_at`, `entry_id` (FK → `entries`, при публикации), `recorders` (jsonb — кто записал), `claim_owner`/`lease_expires_at` (право транскрибации), `status` (`awaiting_review`\|`in_base` — публикация), `summary_status` (`processing`\|`done`\|`failed` — фоновая транскрибация+тезисы, отдельно от `status`), `group_id` (FK → `workspaces.id`). Личные пометки участников — отдельные приватные `entries` с `metadata.meeting_id` |
| `sessions` | Состояние диалога бота | `chat_id` (PK), `action`, `context` (jsonb), `updated_at` (TTL 30 мин) |
| `allowed_users` | Белый список | `telegram_id`, `username`, `is_admin`, `group_id` (FK → `workspaces.id`) |
| `user_profiles` | Профили пользователей | `telegram_id`, `first_name`, `last_name`, `role`, `markets`, `phone`, `email`, `notes`, `name_aliases`. ⚠️ **`username` здесь НЕТ** — он в `allowed_users`. Имя = `first_name`+`last_name`, фолбэк на `@username` из `allowed_users` (хелпер `resolveNames` в swarm-api). Не селектить `username` из `user_profiles` — PostgREST упадёт на несуществующей колонке → `data=null` |
| `user_integrations` | API-ключи интеграций | `telegram_id`, `service` (`granola`), `api_key`, `last_polled_at`, `skipped_note_ids` |
| `app_settings` | Глобальные настройки | `key`, `value` — хранит `feedback_channel_id` |
| `oauth_tokens` | OAuth токены интеграций | `service` (`read_ai`), `client_id`, `access_token`, `refresh_token`, `expires_at`, `updated_at` |
| `oauth_state` | Временный PKCE state для OAuth | `state`, `client_id`, `code_verifier` — создаётся при старте OAuth, удаляется после callback |
| `task_comments` | Комментарии к задачам | Таблица существует, код не использует — не задействована |

**Миграции:** `supabase/migrations/` — файлы по дате. Начальная схема (`CREATE TABLE entries` и др.) **отсутствует** в миграциях (исторический долг).

---

## Флоу сохранения записей (entries)

Всё проходит через `saveEntry()` в `lib/storage.ts` (исключение: granola.ts делает прямой insert, но с той же логикой индексирования).

### Роутинг входящего текста: сохранить vs искать (детерминированно)

Решение «сохранить или искать» НЕ отдаётся LLM (раньше отдавалось → бот непредсказуемо то сохранял, то искал один и тот же тип сообщения). Порядок в `index.ts` (ветка `if (!isCommand)`), сверху вниз:

1. Активные сессии (`manage_replace`, `waiting_add`, `waiting_ask`, `sa_*`, meeting/user/task/granola/feedback) — их вход.
2. `classifyEntryCommand` (удали/замени запись) → `handleEntryCommand`.
3. Голый URL <300 символов → `handleUrl`.
4. **Пересланное сообщение** (`forward_origin`/`forward_date`/`forward_from`/`forward_from_chat` в `TgMessage`) → **`handleAdd` (сохранить сразу + тезисы)**. Самый надёжный сигнал «это контент». Не доходит до GPT.
5. **Явная команда сохранения** — `parseSaveCommand` (`intent.ts`): `сохрани/запомни/занеси/запиши/внеси[:] …` или `<глагол> … в базу/знания/хранилище/рой/сворм/swarm/улей[:] …` → `handleAdd`. «добавь» без destination сюда НЕ входит (это была бы задача).
6. Иначе текст ≥3 символов → `handleAsk` (вопрос/поиск). Агент сохранять **не умеет**, кроме `save_private` (только явное «в личное»).

**Recency-вопросы** («что только что/последнее сохранил», «что нового в базе» по времени) обслуживает инструмент `list_recent` (сортировка по `created_at`), а НЕ `search_knowledge` — семантика ранжирует по смыслу и вернула бы старую нерелевантную запись.

### Типы источников (`source`)
| source | Откуда | Как индексируется |
|--------|--------|-------------------|
| `telegram` | Текст ≥300 символов через /add | `buildEntryIndex` (1 GPT вызов): summary + страны + тип + keywords |
| `note` | Текст <300 символов через /add | GPT keyword-enrichment в `handleAdd`, General тег автоматически |
| `link` | URL с описанием | GPT расширение описания в `media.ts`, затем `saveEntry` |
| `voice` | Голосовое | Whisper транскрипция → `saveEntry` (summary через `buildEntryIndex`) |
| `document` | Файл TXT/XLSX/CSV | `generateSummary(полный_текст)` → chunks через `saveEntry` |
| `granola` | Granola API | GPT tezisy в `granola.ts` → прямой insert с enriched embedding |
| `read_ai` | Read.ai webhook | Tezisy в `read-ai-webhook` → `saveEntry` |
| `digest` | /digest команда | Прямой `saveEntry` без summary |

### Пайплайн `saveEntry` / `buildEntryIndex`
```
content + [existingSummary?]
  → buildEntryIndex (1 GPT вызов):
      если нет summary  → {summary, countries, entry_type, entry_date, keywords}
      если есть summary → {countries, entry_type, entry_date, keywords}  (summary not re-generated)
  → General tag:
      countries.length === 0 OR >= 3 → добавить "General"
  → embedding на обогащённом тексте:
      "${summary}\nСтраны: ${specific}\nКлючевые слова: ${keywords}"
  → INSERT entries
  → return {id, summary}
```

### source='note' (короткие справочные записи)
Отдельный путь — без `buildEntryIndex`, всегда `countries: ["General"]`. GPT генерирует keyword-индекс в `handleAdd` для поиска.

---

## Флоу встреч

### Granola (ручной импорт через /granola)
```
/granola → выбор периода → список заметок (gp_/gd_)
         → [gp_] генерация тезисов → показ тезисов
         → [gedit_] инструкция пользователя → GPT переписывает → показ обновлённых тезисов
         → [gc_/gcp_] сохранение в entries (общее/личное)
         → [gd_] пропустить (запись в skipped_note_ids)
```

### Granola (автоматический поллер) — зеркало Read.ai
```
hourly cron → swarm-bot { granola_poll:true } → ingestNewGranolaNotesAllUsers (handlers/granola.ts)
  → для каждой новой заметки (дедуп по granola_note_id + skipped, окно 48ч, ≤10/прогон):
      тезисы (GPT) + эмбеддинг → insert в entries (source=granola, entry_type=meeting, confirmed=FALSE)
  → встреча сразу видна в вебе «на согласовании» (GET /meetings?confirmed=false)
  → Telegram: те же кнопки ревью что у Read.ai [✅ Сохранить mc_ / ✏️ Название met_ / 📅 Дата med_ / 🗑 Удалить md_]
  → подтверждение в вебе (PATCH confirmed:true) ИЛИ в Telegram (mc_) — единый флоу meetings.ts
```
> Принцип: «всё что в Telegram, то и в вебе». Старая standalone-функция `granola-poller`
> (только слала уведомление, ничего не клала в БД) **выведена из крона** этим флоу.
> Ручной `/granola` (ниже) сохраняет сразу `confirmed:true` — это явное действие пользователя.

### Read.ai (автоматически)
```
Read.ai webhook → read-ai-webhook функция → сохраняет в entries (confirmed=false)
  → Telegram уведомление: [✅ Подтвердить / ✏️ Редактировать / 🗑 Удалить]
  → /meetings показывает все unconfirmed → mr_ → детальный просмотр
```

### Тезисы — AI-редактирование (✏️ Тезисы / ✏️ Переписать)
- **До сохранения (preview):** `gedit_` → сессия `granola_edit_preview_<noteId>` → инструкция → GPT переписывает → сессия восстанавливается в `granola_preview_<noteId>` → можно итерировать
- **После сохранения (/meetings):** `medit_` → сессия `meeting_edit_summary_<entryId>` → инструкция → GPT переписывает, читая `entries.content` + `entries.summary`

### swarm-api: PATCH /meetings и preview-извлечение задач (для desktop-ревью встреч)
- `PATCH /meetings/:id` принимает (помимо `confirmed`/`summary`/`countries`): `content` (правка текста), `is_private` (+ `owner_id` задаётся/снимается как у задач), `entry_type` (реклассификация «встреча → заметка», уводит запись из очереди `GET /meetings`).
- `POST /tasks/extract { text, save:false }` — возвращает предложенные задачи БЕЗ создания (preview). Без `save:false` (по умолчанию) — старое поведение: создаёт задачи и возвращает их.

### Swarm Meetings (desktop-agent) — В РАЗРАБОТКЕ
Замена Read.ai/Granola: лёгкий **свой** macOS-рекордер (Swift/ScreenCaptureKit, **без форка anarlog**) пишет аудио онлайн-звонков и шлёт в Swarm Brain; **транскрибация и тезисы — в облаке (OpenAI)**, без локальной модели. Полный дизайн — `transcribator/10-REVISED-DESIGN.md`.
```
Все участники записывают аудио → meeting-claim (до загрузки):
  первый получает decision=transcribe, остальные defer (lease с TTL, перехват по истечении);
  каждый регистрируется в meetings.recorders; его пометки → приватная entry (metadata.meeting_id)
claimer → meeting-ingest: грузит АУДИО → сервер транскрибирует (OpenAI Whisper) → meetings.transcript
  → async GPT-тезисы → meetings.draft_notes_md (общий черновик, НЕ в базе знаний/поиске)
  → уведомление записавшим «готово к вычитке»
вычитка (PATCH /agent-meetings/:id) + аппрув (POST /agent-meetings/:id/publish):
  создаётся entries (выбор базы: воркспейс/личное), эмбеддинг, status=in_base.
  Один объект → из «на вычитке» уходит у всех разом
```
**Эндпоинты swarm-api (вызывает веб/Mini App, auth — сессия роя):** `GET /agent-meetings?status=` (очередь вычитки/опубликованные; видны записавшим или админу), `GET /agent-meetings/:id` (черновик + транскрипт), `PATCH /agent-meetings/:id` (правка `draft_notes_md` → `notes_edited_at`), `POST /agent-meetings/:id/publish` (`{base: workspace|personal}` → создать entries, привязать, идемпотентно).

Дедуп нескольких записавших — по `meetings.identity_key` (calendar/room; manual без дедупа, дубли — ручным «объединить»). Аутентификация агента — персональный токен (`_shared/agent-auth.ts`, личность из токена, не из payload). Фильтры источников включают `desktop-agent` (swarm-api `GET /meetings`, MCP `get_meetings`, бот `rai_saved`).

**Веб (miniapp):** `MeetingReview` — страница вычитки одной встречи (тезисы редактируются, транскрипт под спойлером, участники, публикация с выбором базы команда/личное); `AgentReviewQueue` — очередь «на вычитке» в разделе Встречи (невидима без черновиков). Deep-link из уведомления: `?meeting=<id>` (браузер) / `startapp=meeting_<id>` (Mini App) → `getDeepLinkMeetingId()` в `lib/telegram.ts` открывает вычитку. **Дедуп вкладок/окон** (Telegram Desktop открывает ссылку новой вкладкой каждый раз): `lib/single-tab.ts` + `SingleTabGate` (в `layout.tsx`) — новая вкладка с `?meeting=` через `BroadcastChannel` + `navigator.locks` (лидер `swarm-leader`) отдаёт встречу уже открытой вкладке и закрывается; установленный PWA через `launch_handler: focus-existing` + `handle_links` в манифесте ловит ссылку в существующее окно (`window.launchQueue`). Обе ветки → событие `roy:open-meeting` → `openMeeting(id)` в `RoyApp`. Спек: `docs/superpowers/specs/2026-06-17-single-tab-reuse-design.md`.

**Статус:** **задеплоено на прод** (`vbqglndbxkpmreccpqmr`) — таблица `meetings` (через `apply_migration`: `supabase db push` нельзя, история миграций дрифтит — локальные файлы и remote-записи расходятся по таймстампам) + функции `meeting-claim`/`meeting-ingest`/`swarm-api`/`swarm-mcp`/`swarm-bot`. Smoke-тест auth зелёный (нет/невалидный токен → 401). Осталось: ~~`WEB_BASE_URL`~~ ✅ выставлен (`https://swarm-brain.pages.dev`) — в уведомлении «тезисы готовы» теперь есть кнопка «Открыть» на `/?meeting=<id>`; веб-страница уезжает на прод через Cloudflare Pages (зависит от ветки CF — push в `sandbox_vas` сделан); полный e2e с реальным `smcp_`-токеном; ~~экстракция задач при публикации~~ ✅ при публикации (`POST /agent-meetings/:id/publish`) тезисы прогоняются через `createMeetingTasks` (GPT-4o-mini → `createTask` с привязкой `meeting_id`, резолвом исполнителей по имени и наследованием приватности базы; сбой извлечения не валит публикацию); агент — **свой лёгкий рекордер** (Swift/ScreenCaptureKit, захват звука + отправка аудио), ещё не написан. Транскрибация/тезисы — облако OpenAI (`meeting-ingest` принимает аудио).

---

## Сессионный механизм

Хранится в таблице `sessions` (`chat_id` → `{action, context, updated_at}`). Один активный сеанс на chat_id. TTL = 30 мин: `getSession` удаляет запись если `updated_at` старше 30 мин. `/reset` очищает сессию явно.

| Prefix action | Файл | Описание |
|--------------|------|---------|
| `waiting_add` | index.ts | Ожидание текста для /add |
| `waiting_ask` | index.ts | Ожидание вопроса для /ask |
| `granola_custom_period` | granola.ts | Ожидание даты для кастомного периода |
| `granola_preview_<noteId>` | granola.ts | Кэш {content,title,tezises} для preview перед сохранением |
| `granola_edit_preview_<noteId>` | granola.ts | Ожидание инструкции для AI-редактирования тезисов (до сохранения) |
| `meeting_pending_<meetingId>` | meetings.ts | Кэш {content,title} для Read.ai встречи до сохранения |
| `meeting_title_<entryId>` | meetings.ts | Ожидание нового названия встречи |
| `meeting_date_<entryId>` | meetings.ts | Ожидание новой даты встречи |
| `meeting_edit_summary_<entryId>` | meetings.ts | Ожидание инструкции для AI-редактирования тезисов (после сохранения) |
| `meeting_rename_<entryId>` | meetings.ts | Ожидание переименования встречи |
| `meeting_tag_<meetingId>` | meetings.ts | Ожидание тегов/стран |
| `feedback_text` | feedback.ts | Ожидание текста фидбека |
| `feedback_photo` | feedback.ts | Ожидание скриншота или кнопки "Готово" |
| `task_*` | tasks/handlers.ts | Различные состояния для создания/редактирования задач |
| `user_*` | users.ts | Состояния управления пользователями |
| `sa_adduser_<wsId>` | superadmin.ts | Ожидание Telegram ID / @username для добавления в воркспейс |
| `sa_create_id` | superadmin.ts | Ожидание ID нового воркспейса |
| `sa_create_name_<wsId>` | superadmin.ts | Ожидание названия нового воркспейса |
| `sa_rename_<wsId>` | superadmin.ts | Ожидание нового названия воркспейса |
| `manage` | manage.ts | Выбор записи для правки/удаления (context: `{cmd,newValue}`) |
| `manage_replace` | manage.ts | Ожидание нового значения для замены (context: id записи) |

---

## Callback-коды (Telegram inline кнопки)

### Granola
| Код | Действие |
|----|---------|
| `gp_<noteId>` | Показать тезисы (preview) |
| `gc_<noteId>` | Сохранить в общую базу |
| `gcp_<noteId>` | Сохранить в личное хранилище |
| `gd_<noteId>` | Пропустить заметку |
| `gedit_<noteId>` | Начать AI-редактирование тезисов |
| `gran_today/7d/30d/custom` | Выбор периода для /granola |

### Meetings (Read.ai + Granola saved)
| Код | Действие |
|----|---------|
| `mr_<entryId>` | Открыть детальный просмотр встречи |
| `mc_<entryId>` | Подтвердить встречу |
| `medit_<entryId>` | Редактировать тезисы (AI) |
| `mrename_<entryId>` | Переименовать встречу |
| `mtr_<entryId>` | Скачать транскрипт |
| `mtag_<meetingId>` | Установить теги/страны |
| `massign_<meetingId>` | Назначить участников |
| `md_<entryId>` | Удалить встречу |
| `met_<entryId>` | Редактировать название (из confirmation flow) |
| `med_<entryId>` | Редактировать дату (из confirmation flow) |
| `rai_saved/import/connect` | Подменю Read.ai |
| `meeting_<id>` | Открыть конкретную Read.ai встречу |
| `meeting_save_pub_<id>` | Сохранить Read.ai встречу в общую базу |
| `meeting_save_priv_<id>` | Сохранить Read.ai встречу в личное |
| `meeting_discard_<id>` | Не сохранять Read.ai встречу |
| `mau_<meetingId>_<tgId>` | Добавить участника встречи |
| `mexp_<entryId>` | Экспортировать встречу файлом |

### Управление записями (правка/удаление из чата)
| Код | Действие |
|----|---------|
| `kbpick_<id>` | Выбрать запись из списка совпадений |
| `kbdo_<id>` | Подтвердить удаление / замену (значение известно) |
| `kbask_<id>` | Запросить новое значение для замены |
| `kbno` | Отмена |

Флоу: `удали/замени запись X` → `classifyEntryCommand` → `handleEntryCommand` ищет (vector+ilike, `visibilityFilter`+`group_id`) → карточка с кнопкой подтверждения → `getManageableEntry` (гейт: воркспейс + приватность) → `delete` / `updateEntryContent` (пересчёт summary/embedding).

### Superadmin (`/superadmin`)
| Код | Действие |
|----|---------|
| `sa_main` | Главное меню суперадмина |
| `sa_spaces` | Список всех воркспейсов с количеством пользователей |
| `sa_create` | Начать создание воркспейса |
| `sa_sp_<wsId>` | Детали воркспейса |
| `sa_su_<wsId>` | Список пользователей воркспейса |
| `sa_u_<tgId>_<wsId>` | Детали пользователя |
| `sa_mv_<tgId>_<wsId>` | Выбор воркспейса для перемещения |
| `sa_mvto_<tgId>_<toWsId>` | Подтвердить перемещение |
| `sa_blk_<tgId>_<wsId>` | Удалить пользователя из системы |
| `sa_add_<wsId>` | Начать добавление пользователя |
| `sa_ren_<wsId>` | Начать переименование воркспейса |

### Tasks (браузер `/tasks`)
| Код | Действие |
|----|---------|
| `tk_menu` | Главное меню задач |
| `tk_pending` | Задачи на проверке (статус pending, созданные мной) |
| `tk_pen_<taskId>` | Открыть карточку pending-задачи |
| `tk_today` | Задачи на сегодня / просроченные |
| `tk_mine` | Мои задачи (edit-in-place список) |
| `tk_all` | Все задачи команды |
| `tk_add` | Создать задачу (запускает addtask сессию) |
| `tk_t_<taskId>` | Детали задачи |
| `tk_st_<taskId>_<status>` | Сменить статус задачи |
| `tk_del_<taskId>` | Запрос подтверждения удаления |
| `tk_delc_<taskId>` | Подтвердить удаление задачи |
| `tc_<taskId>` | Подтвердить pending-задачу: `confirmed=true`, `status=open`, отправить Telegram-уведомления исполнителям |
| `tdue_<taskId>` | Ввод нового дедлайна в свободной форме (из pending-карточки) |
| `tctag_<taskId>` | Открыть пикер страны и тегов |
| `tctagc_<taskId>:<country\|none>` | Установить страну задачи |
| `tctagr_<taskId>:<tag>` | Переключить тег задачи (toggle) |

### Feedback
| Код | Действие |
|----|---------|
| `fb_done` | Пропустить скриншот, сохранить фидбек без фото |
| `fb_read_<feedbackId>` | Кнопка "Прочитано" в канале — удалить из БД и убрать сообщение |

---

## Таблица feedback

| Колонка | Тип | Описание |
|---------|-----|---------|
| `id` | uuid PK | |
| `telegram_id` | bigint | Кто отправил |
| `username` | text | Telegram username |
| `text` | text NOT NULL | Текст фидбека |
| `photo_file_id` | text | file_id скриншота (null если нет) |
| `created_at` | timestamptz | |

Канал для пересылки: `app_settings.feedback_channel_id` (chat_id группы/канала). Если не задан — фидбек только в БД.

Формат сообщения в канале: `[BOT_NAME] 🐛 @username · дата\n\nтекст`. Имя бота берётся из env-переменной `BOT_NAME` (по умолчанию `"bot"`). Позволяет использовать одну общую группу для нескольких ботов.

---

## Контроль доступа

- `checkAllowed(userId)` в `lib/storage.ts` — проверка белого списка
- `checkAllowedWithGroup(userId)` в `lib/workspace.ts` — проверка белого списка + возвращает `group_id` пользователя одним запросом
- `visibilityFilter(userId)` — строка фильтра для запросов: `is_private=false OR (is_private=true AND owner_id=userId)`
- `ADMIN_USER_ID = 744230399` в `lib/supabase.ts` — всегда имеет доступ, единственный кто может управлять воркспейсами
- Все запросы через `SERVICE_ROLE_KEY` — RLS не работает, фильтрация только в коде
- Workspace-изоляция: все запросы к `entries` и `tasks` фильтруются по `group_id` пользователя — пользователь видит только данные своего воркспейса

## Воркспейсы

Воркспейсы — механизм мультитенантности внутри одного бота. Каждый пользователь принадлежит ровно одному воркспейсу и видит только его данные.

**Как работает изоляция:**
- `allowed_users.group_id` — воркспейс пользователя
- `entries.group_id` и `tasks.group_id` — к какому воркспейсу принадлежит запись/задача
- При любом запросе `getUserGroupId(userId)` резолвит `group_id` пользователя, после чего все запросы к БД фильтруются по этому `group_id`
- MCP-сервер (`swarm-mcp`) резолвит `group_id` из `requesting_user_id` — данные через Claude Desktop также изолированы по воркспейсу

**Личные записи при смене воркспейса:**
- Записи с `is_private=true` привязаны к `owner_id` (владелец) — они переезжают вместе с пользователем при смене воркспейса

**Текущие воркспейсы:**
- `cee` / "CEE" — Central & Eastern Europe
- `other` / "Other Markets" — остальные рынки

**Особые случаи:**
- Read.ai webhook хардкодит `group_id = 'cee'` — один OAuth токен обслуживает только один воркспейс

**Команды суперадмина (`/workspace`):**
- `/workspace list` — список всех воркспейсов
- `/workspace create <id> <name>` — создать новый воркспейс
- `/workspace add <userId> <workspaceId>` — добавить пользователя в воркспейс
- `/workspace move <userId> <workspaceId>` — перевести пользователя в другой воркспейс

Команды доступны только `ADMIN_USER_ID`. Логика — в `handlers/workspace.ts`, CRUD-операции — в `lib/workspace.ts`.

---

## MCP-аутентификация

Персональные токены вместо `requesting_user_id` на доверии.

**Механизм:**
- `allowed_users.claude_mcp_token_hash TEXT` — sha256(token) в hex; plaintext никогда не хранится
- `allowed_users.claude_mcp_token_expires_at timestamptz` — срок жизни токена. **MCP-токен бессрочный**: `mintMcpToken` пишет `null`, а `swarm-mcp`/`agent-auth` трактуют `null` как «без срока» (проверка `expires_at && expires_at < now()` короткозамыкается). Колонка остаётся для рекордера и на случай возврата TTL
- `allowed_users.recorder_token_hash`/`recorder_token_expires_at` — **отдельный токен рекордера** (`/recordertoken`, 365 дней), независимый от MCP-токена: перевыпуск `/mytoken` в Claude Desktop не ломает рекордер. `agent-auth` (meeting-claim/ingest) принимает claude_mcp_token_hash **ИЛИ** recorder_token_hash
- Claude Desktop отправляет `Authorization: Bearer smcp_<uuid>` с каждым запросом
- `swarm-mcp/index.ts` — одна точка проверки сразу после разбора тела запроса:
  1. sha256(token) → lookup по `claude_mcp_token_hash` → `verifiedTelegramId`
  2. Если `claude_mcp_token_expires_at` в прошлом → отказ `Token expired`
  3. Инжектируется в `args.requesting_user_id` — значение из тела игнорируется
  4. `MCP_AUTH_REQUIRED=true` → строгий режим (без токена — отказ)
- Выдача: `/setup` в боте (минтит токен + даёт команду авто-установки, см. `swarm-setup`), `/mytoken` (ручной токен для своего config.json) или `SELECT generate_mcp_token(<telegram_id>)` в SQL. Plaintext единожды. Логика минта — общий хелпер `swarm-bot/lib/mcp-setup.ts` (`mintMcpToken`)
- ⚠️ **`/mytoken` не перевыпускает молча**: если живой токен уже есть (`hasActiveMcpToken`), бот предупреждает и просит подтверждения кнопкой (`callback_data: mtk_reissue`) — иначе случайный `/mytoken` убил бы рабочий `config.json`. `/setup` минтит всегда (ему нужен plaintext для команды) и сам же переписывает config, поэтому самосогласован
- Отзыв: `/revoketoken` в боте или `SELECT revoke_mcp_token(<telegram_id>)` (гасит хэш + срок)
- ⚠️ В `claude_desktop_config.json` использовать только stdio-форму (`command`+`mcp-remote`); поле `url`/`type:http` Claude Desktop молча затирает весь `mcpServers` (anthropics/claude-code#37286)

**Доступ при выходе коннектора в орг-список Claude:**
Орг-список управляет только видимостью коннектора, не доступом к данным. Шлюз — токен:
- В soft-режиме (`MCP_AUTH_REQUIRED` не выставлен) `requesting_user_id` берётся из аргументов **на доверии** → любой член орга читает всё. **Перед публикацией в орг обязательно `MCP_AUTH_REQUIRED=true`.**
- В strict-режиме доступ есть только у владельцев валидного `smcp_`-токена; нежелательные члены орга получают `401`. Даже владелец токена видит лишь свой `group_id` и свои приватные записи.

Ошибка при невалидном/отсутствующем токене: JSON-RPC -32001 "Unauthorized".

---

## Переменные окружения

| Переменная | Где используется | Обязательная |
|-----------|----------------|-------------|
| `TELEGRAM_BOT_TOKEN` | swarm-bot, granola-poller | да |
| `SUPABASE_URL` | все функции | да |
| `SUPABASE_SERVICE_ROLE_KEY` | все функции | да |
| `OPENAI_API_KEY` | swarm-bot, swarm-mcp | да |
| `BOT_NAME` | swarm-bot (feedback) | нет, дефолт `"bot"` |
| `MCP_AUTH_REQUIRED` | swarm-mcp | нет; `true` = жёсткий режим (без токена — отказ) |

---

## swarm-api — Mini App backend

```
supabase/functions/swarm-api/
├── index.ts        # Router + все эндпоинты
├── auth.ts         # verifyInitData() — утилита проверки Telegram initData
├── admin.ts        # /admin/* роуты (только telegram_id 744230399)
└── entries-guard.ts  # Обязательный слой безопасности для всех endpoints с entries
```

**Назначение:** REST API для Telegram Mini App (доска задач). Третий клиент поверх `_shared/tasks/db.ts`.

**Безопасность entries — `entries-guard.ts`:**

`entries` содержит личные хранилища пользователей. `service_role_key` обходит RLS — вся защита в коде.

Два обязательных хелпера, которые нужно использовать во всех entry-endpoints:

| Хелпер | Когда использовать | Что проверяет |
|--------|--------------------|---------------|
| `getEntrySecure(supabase, id, { groupId, telegramId, requireOwner? })` | GET /:id, PATCH, DELETE | 1) workspace (`group_id`), 2) visibility (`is_private`), 3) ownership (если `requireOwner=true`) |
| `buildEntriesQuery(supabase, select, { groupId, telegramId })` | GET /entries, GET /search | Возвращает query с workspace + visibility фильтрами уже встроены |

Обернуть handler в `withEntries(origin, async () => { ... })` — перехватывает `EntryAccessError` → 404/403.

**Запрещено:** `supabase.from("entries").select(...)` напрямую в endpoint'ах — только через хелперы.

Оба случая недоступности (entry не существует / entry приватная чужая) возвращают 404 — утечка информации о существовании чужой записи недопустима.

**Аутентификация (два режима, оба резолвятся в `telegram_id`):**

1. **Telegram Mini App** — `Authorization: tma <initData>`
   - Проверка подписи: `secret_key = HMAC("WebAppData", BOT_TOKEN)`, `hash = HMAC(secret_key, data-check-string)`
   - Свежесть `auth_date` (дефолт 24ч, `INITDATA_MAX_AGE`)
   - `telegram_id` из `user` в initData
2. **Браузер (веб, R-5 вариант B+)** — `Authorization: Bearer <JWT>` (HS256, `WEB_JWT_SECRET`)
   - JWT выдаёт CF Pages Function `/api/auth/telegram` после проверки подписи Login Widget, кладёт в httpOnly-cookie `roj_session` (7 дней)
   - Прокси `/api/[[path]].ts` перекладывает cookie → `Bearer` при форварде в swarm-api (httpOnly недоступен JS и не уходит cross-origin)
   - Выход/смена аккаунта: `POST /api/auth/logout` гасит cookie (`Max-Age=0`) → редирект на `/login`. Кнопка в Настройках (`AccountSection`), показывается только в браузерной сессии (`!getInitData()`)

После аутентификации (любой режим):
- Резолвит `telegram_id → group_id` через `allowed_users`
- `group_id` — единственный источник истины для скоупинга данных, из тела запроса не берётся

**Эндпоинты:**

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/me` | `{ telegram_id, name, group_id, language, role, markets, is_admin }` |
| `GET` | `/config` | `{ allowed_markets: string[] }` — ISO коды рынков воркспейса (из `workspaces.allowed_markets`, или глобальный список) |
| `GET` | `/users` | Участники воркспейса с профилями |
| `GET` | `/tasks` | Список задач. Фильтры: `status`, `country`, `assignee`, `mine`, `limit`, `confirmed`, `sprint_id`, `tags` (csv, ANY), `start_date_from/to`, `due_date_from/to`. **Приватность:** приватные задачи видны только владельцу (админ — все). Дополняется `created_by_name` |
| `GET` | `/tasks/:id` | Одна задача. Приватная чужая → 404 |
| `POST` | `/tasks` | Создать (`assignee_telegram_id` → имя); поля Роя: `is_private` (→`owner_id`), `start_date`, `sprint_id`, `tags`, `timeline_position`; валидация `start_date<=due_date` и принадлежности спринта воркспейсу; `confirmed=true` |
| `PATCH` | `/tasks/:id` | Частичный апдейт. Приватную чужую → 404, мутация приватной не владельцем → 403. Поддержаны новые поля + смена `is_private`, привязка к спринту |
| `DELETE` | `/tasks/:id` | Удалить (204). Приватную чужую → 404/403 |
| `GET` | `/tasks/:id/dependencies` | Зависимости задачи (incoming + outgoing) |
| `POST` | `/tasks/:id/dependencies` | Создать `{ depends_on_id, dependency_type }`; self→400, цикл→422, дубль→409 |
| `DELETE` | `/tasks/:id/dependencies/:depId` | Удалить зависимость (204) |
| `GET` | `/sprints` | Спринты воркспейса (все участники) |
| `POST` | `/sprints` | Создать спринт (`name`, `start_date`, `end_date`, `status`) — **только admin** |
| `PATCH` | `/sprints/:id` | Обновить спринт — только admin |
| `DELETE` | `/sprints/:id` | Удалить (задачи освобождаются, FK SET NULL) — только admin |
| `POST` | `/sprints/:id/tasks` | Привязать задачи `{ task_ids }` (только командные) |
| `DELETE` | `/sprints/:id/tasks` | Отвязать задачи `{ task_ids }` |
| `GET` | `/admin/workspaces` | Список воркспейсов с user_count (только admin) |
| `GET` | `/admin/workspaces/:id/users` | Пользователи воркспейса (только admin) |
| `POST` | `/admin/workspaces/:id/users` | Добавить пользователя (только admin) |
| `DELETE` | `/admin/workspaces/:id/users/:uid` | Удалить пользователя (только admin) |
| `PATCH` | `/admin/workspaces/:id` | Обновить name/allowed_markets (только admin) |
| `GET` | `/search?q=` | Семантический поиск по `entries` (вектор `match_entries`, threshold 0.3) → `Entry[]` |
| `POST` | `/ask` | RAG-ответ (экран Answer редизайна): embed → `matchEntries` (топ-8, приватность+воркспейс в RPC) → GPT-4o-mini синтез строго по источникам со сносками `[n]` → `{ query, answer, sources[], followups[] }`. Пусто → без GPT; сбой синтеза → деградация до источников |

**Переменные окружения:** `TELEGRAM_BOT_TOKEN` (уже есть), `MINIAPP_ORIGIN`, `INITDATA_MAX_AGE` (опц.)

**Деплой:** `supabase functions deploy swarm-api --no-verify-jwt`

---

## swarm-mcp — структура файлов

```
supabase/functions/swarm-mcp/
├── index.ts        # MCP-сервер: регистрация инструментов, роутинг вызовов
└── tasks/
    └── tools.ts    # Прослойка: резолв user/assignee → _shared/tasks/db.ts → форматирование строк
```

**Инструменты (tools) swarm-mcp:**

| Инструмент | Назначение |
|-----------|-----------|
| `search_knowledge` | Семантический поиск по базе знаний |
| `add_knowledge` | Добавить запись в базу знаний |
| `get_entry` | Получить запись по ID |
| `list_entries` | Список записей с фильтрами |
| `update_entry` | Обновить запись (контент, тезисы, файл) |
| `delete_entry` | Удалить запись |
| `upload_file` | Загрузить файл в Storage + добавить запись |
| `get_meetings` | Список встреч |
| `get_storage_stats` | Статистика хранилища |
| `get_users` | Список пользователей воркспейса |
| `add_task` | Создать задачу (с fuzzy-матчингом исполнителя) |
| `update_task` | Обновить задачу |
| `delete_task` | Удалить задачу |
| `get_tasks` | Список задач с фильтрами |

Все инструменты принимают `requesting_user_id` (Telegram ID) для резолва воркспейса.

---

## app_settings — ключи

| Ключ | Тип значения | Назначение |
|------|-------------|-----------|
| `feedback_channel_id` | number (chat_id) | Telegram-группа для пересылки фидбеков. Текущее значение: `-1003955027649` |
| `granola_last_polled_at` | ISO timestamp | Время последнего опроса Granola-поллером |

---

## Mini App frontend — miniapp/

Next.js 16 приложение внутри монорепо, полностью отдельное от Deno Edge Functions.

```
miniapp/
├── src/app/           # Next.js App Router
│   ├── layout.tsx     # Root layout
│   ├── page.tsx       # Главная страница
│   └── globals.css    # Tailwind base styles
├── public/            # Статические ассеты
├── next.config.ts     # output: "export", images: unoptimized
├── .env.local.example # Пример переменных окружения (в git)
└── .env.local         # Локальные переменные (gitignored)
```

**Конфигурация:**
- `output: "export"` — статический HTML/CSS/JS в `miniapp/out/`, без сервера
- Деплой: Cloudflare Pages (из директории `out/`)
- TypeScript + Tailwind CSS

**Редизайн под `design_handoff_roy` (Claude Design) — фазы 1–7 в проде:**
- **Дизайн-токены** из хендоффа на shadcn-переменных (`globals.css`): тёплая бумага `#F4F1EB`, янтарный бренд `#D98A2B`, три уровня текста, статусы/приоритеты/типы, радиус карточек 18px, мета на Golos (моно — только таймстампы транскрипта). Семантический слой вынесен в `@theme` (`bg-surface-2`, `text-ink-soft`, `text-status-open`, …).
- **Дизайн-система `src/components/roy/`**: `icons.tsx`, `ui.tsx` (Card/TypeTag/Market/Avatar/Chip/Segmented/Header/IconBtn/SectionLabel/FAB/NavHeader/RoyTabBar), `nav.ts` (контекст), `entry.ts` (deriveEntryTitle/entryTagKey), `useIsDesktop.ts`, `RoyDashboard.tsx` (бенто-дашборд десктопа).
- **IA**: `RoyApp.tsx` — 4 корневых таба + push-стек деталей вместо плоских секций/модалок; аватар-меню «Ещё» (Настройки/Команда/Админ). **Адаптив:** мобайл — нижний таб-бар; десктоп (lg+) — левый `RoySidebar`. Домашняя вкладка «Поиск» на десктопе — **бенто-дашборд `RoyDashboard`** во всю ширину (≤1240px): поиск-герой сверху + три панели сразу (Задачи крупно слева на всю высоту, Встречи и База справа), каждая скроллится внутри себя и раскрывается в полную вкладку по клику на шапку; на мобайле — `SearchScreen`. Вкладка «Задачи» на десктопе → полный `TasksScreen` с видами Список/Таймлайн/Спринт/Граф; дефолт — **«Список»** в стиле macOS Reminders (смарт-списки Сегодня/Предстоящее/Важное/Все/Готово/По рынкам, линза Мои/Все, бинарный чекбокс), общий с мобайлом через `useReminderTasks`. Канбан остался только в «Спринте». Deep-link встреч и приватность сохранены.
- **Экраны** (`screens/`): `SearchScreen` (герой), `AnswerScreen` (RAG `/ask`: ответ со сносками + источники + «Уточнить»), `RoyTasksScreen` + `TaskDetail` + `NewTask` (поле `priority`), `RoyBaseScreen` + `RecordDetail` + `NewEntry`, `RoyMeetingsScreen` + `MeetingDetail` (вычитка `AgentReviewQueue`/`MeetingReview` и подтверждение/правка/удаление сохранены).
- **Бэкенд под редизайн**: `POST /ask` (RAG), колонка `tasks.priority` (миграция `20260615000000`). Спецификация — `transcribator/08-UI-UX-V2.md` + `design_handoff_roy/`.
- **Хвосты (не блокеры):** визуальная очная проверка десктопа в Telegram; чистка осиротевших старых компонентов (`BottomNav`/`Sidebar`/`KnowledgeScreen`/`MeetingsScreen`/`TaskCard`/`TaskModal`/`*Dialog` — больше не используются `RoyApp`, но `TasksScreen`+виды задач используются на десктопе); бэкенд-расширения из хендоффа (человеческий `title` записи, связь task↔entry) — по желанию.

**Переменные окружения Mini App:**

| Переменная | Значение | Назначение |
|-----------|---------|-----------|
| `NEXT_PUBLIC_API_URL` | `https://*.supabase.co/functions/v1/swarm-api` | URL бэкенда |
| `NEXT_PUBLIC_DEV_MODE` | `true` / `false` | Режим разработки |

**Разработка:**
```bash
cd miniapp
npm run dev    # dev-сервер
npm run build  # статический экспорт в out/
```

**Types (`miniapp/src/types.ts`):**

| Type | Назначение | Ключевые поля |
|------|-----------|-------|
| `Task` | Задача из `GET /tasks` | `id`, `title`, `description`, `assignees`, `due_date`, `status`, `country`, `created_by_name: string \| null`, `created_at` и др. |
| `User` | Участник воркспейса | `telegram_id`, `name`, `username`, `role`, `markets` |
| `Me` | Текущий пользователь + воркспейс | Все поля User + `group_id`, `language`, `is_admin` |
| `Entry` | Запись базы знаний | `id`, `content`, `summary`, `countries`, `entry_type`, `is_private`, `owner_id`, `created_at` |

**API client (`miniapp/src/lib/api.ts`):**
- `fetchTasks()` возвращает `Task[]` с полем `created_by_name`
- `createTask()` при создании автоматически устанавливает `created_by_name` из имени текущего пользователя (в DEV_MODE — из `MOCK_ME.name`)

---

## Деплой и разработка

- Ветка: `sandbox_vas` → всегда разрабатывать здесь, в `main` не коммитить
- Деплой Edge Functions: `supabase functions deploy swarm-bot --no-verify-jwt`
- Деплой обоих: `supabase functions deploy swarm-bot granola-poller --no-verify-jwt`
- Деплой Mini App: `cd miniapp && npm run build` → `out/` → Cloudflare Pages
- После каждого изменения функционала: обновить этот файл + `CHANGELOG.md`
