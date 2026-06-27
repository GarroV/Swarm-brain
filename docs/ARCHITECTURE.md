# Swarm Brain — Architecture

> **Для Claude Code:** Читай этот файл в начале КАЖДОЙ сессии перед тем как трогать код. После любых изменений — обновляй соответствующие разделы сразу.

## Что такое Swarm Brain

Командная база знаний с AI-поиском, управлением задачами и интеграцией встреч — для распределённых команд. Цель: собрать в одном месте всё, что знает команда (заметки, документы, договорённости, итоги встреч, ссылки), и сделать это мгновенно доступным на естественном языке, не выходя из инструментов, где команда уже работает.

**Проблема, которую решает:** институциональное знание расползается по чатам, головам и встречам — новый человек или коллега с другого рынка не может быстро поднять контекст. Swarm Brain централизует знание и отвечает на вопросы по содержимому базы со ссылками на источники, а не «по памяти».

**Кто пользуется:** распределённые команды международного бизнеса. Текущее развёртывание — Dodo Brands, рынки CEE и Other (домен — общепит/доставка: пиццерии в Сербии, Болгарии, Хорватии, Венгрии, Молдове, Румынии и др.). Изоляция данных — по воркспейсам, которые маппятся на группы рынков (`cee` / `other`).

## Поверхности продукта

Четыре пользовательские поверхности поверх одного бэкенда (Supabase Edge Functions + Postgres/pgvector + OpenAI):

| Поверхность | Технология | Для чего | Бэкенд |
|---|---|---|---|
| **Telegram-бот** | Deno Edge Function | Быстрый ввод и поиск, встречи, задачи, фидбек, админка — прямо там, где команда общается | `swarm-bot` |
| **Веб Mini App «Рой»** | Next.js (static export) → Cloudflare Pages | Доска задач (Список/Таймлайн/Спринты/Граф), RAG-поиск, вычитка встреч | `swarm-api` |
| **Claude Desktop (MCP)** | MCP-сервер | Та же база + инструменты внутри Claude Desktop (большие тексты, с проверкой человеком) | `swarm-mcp` |
| **SwarmRecorder** | macOS-приложение (Swift) | Запись звука онлайн-встреч → облачная транскрибация → тезисы в базу | `meeting-claim`, `meeting-ingest`, `meeting-process`, `meeting-status` |

## Сквозные сценарии

1. **Захват.** Переслать боту текст / файл / голос / ссылку → сохраняется в базу (генерятся тезисы, эмбеддинг, страны и тип записи).
2. **Поиск / ответ.** Вопрос боту или в вебе → семантический поиск + RAG-ответ со сносками на источники.
3. **Встречи.** Read.ai / Granola авто-импорт или SwarmRecorder → черновик «на согласовании» → правка/подтверждение в вебе или Telegram → запись в базе; задачи извлекаются автоматически.
4. **Задачи.** Извлечены из встречи или созданы вручную → назначение и трекинг (спринты, зависимости, таймлайн — в вебе).
5. **Claude Desktop.** Та же база и те же операции через MCP-инструменты (по персональному токену).

## Глоссарий

- **«Рой»** (Swarm по-русски) — веб / Mini App фронтенд продукта.
- **Воркспейс** (workspace, поле `group_id`) — тенант, единица изоляции данных; маппится на группу рынков (`cee` / `other`).
- **entry** — запись базы знаний (таблица `entries`). **meeting** — источник истины о встрече рекордера (таблица `meetings`). Это разные сущности, не путать.
- **`/meetings`** — подтверждённые записи-встречи в `entries`; **`/agent-meetings`** — черновики рекордера в `meetings` до публикации.
- **claim / lease** — право на транскрибацию встречи, выдаваемое одному из записавших (чтобы не транскрибировать дубли).
- **`confirmed:false`** — «на согласовании»: встреча сохранена, но ждёт подтверждения в вебе или Telegram.

## Ветка и деплой (канон)

- Разработка только в ветке **`sandbox_vas`**; в `main` не коммитим.
- Edge Functions: `supabase functions deploy <name> --no-verify-jwt`.
- Mini App: `cd miniapp && npm run build` → `out/` → Cloudflare Pages.
- Прод project-ref: `vbqglndbxkpmreccpqmr` (развёртывание Dodo Brands). `ADMIN_USER_ID = 744230399` зашит в `swarm-bot/lib/supabase.ts`.

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
| `swarm-recorder-setup` | HTTP GET (публичный) | Отдаёт bash-установщик SwarmRecorder (macOS) — зеркало `swarm-setup`. Юзер запускает через `/recordertoken`: `curl -fsSL …/swarm-recorder-setup \| SWARM_TOKEN=… bash`. Скрипт: валидирует токен → headless Command Line Tools → `git clone --branch sandbox_vas` → `recorder/setup-signing.sh` (идемпотентный self-signed cert для стабильного TCC, **без доверия/пароля** — codesign подписывает недоверенным, DR держится на cert leaf) → `recorder/install.sh` (swift build → .app → подпись → /Applications) → авто-запись `config.json` с токеном. Текст — `swarm-recorder-setup/script.ts` |
| `meeting-claim` | HTTP POST (desktop-agent) | Swarm Meetings: claim/lease до транскрибации (кто транскрибирует), регистрация записавших, личные пометки → приватная entry. Auth — персональный токен |
| `meeting-ingest` | HTTP POST (desktop-agent) | Swarm Meetings: приём **аудио** от claimer (multipart: `sys_parts`/`mic_parts` — JSON-манифест `[{name,offset}]` + файлы; рекордер режет дорожки на части **≤25 МБ И ≤15 мин**; старый одиночный `audio`/`audio_mic` — фолбэк; принимается запись с **одной** дорожкой — только система ИЛИ только микрофон (mic-only НЕ отклоняется: юзер говорил, но через систему ничего не играло → sys-дорожка пустая). **Durable-обработка** (см. `_shared/meeting-processor.ts`): части кладутся в Storage (приватный бакет `meeting-audio`), пишется `process_state`, ставится `summary_status='processing'` + `last_progress_at`; затем короткий **inline-проход** (короткой встрече хватает — добивается сразу). Длинную добивает cron `meeting-process`. Шаг = транскрибация части (Whisper, offset; **галлюцинации на тишине** — ютуб-«титры», «продолжение следует», «спасибо за просмотр» — режутся чёрным списком фраз + порогом `no_speech_prob`/`avg_logprob`) → накопление сегментов → когда все готовы: сводка тезисов (GPT-4o; **бессодержательная запись → короткая плашка вместо GPT-отписки**: `TEZIS_SYSTEM` возвращает сентинел `НЕТ_ТЕЗИСОВ`) + **авто-название** → `done` → уведомление → чистка Storage. Идемпотентность (`processing`/`done` → no-op) + видимость сбоя (`failed`). Auth — персональный токен. Вычитка: `swarm-api` `GET/PATCH/DELETE /agent-meetings/:id` + `POST /agent-meetings/:id/publish` (ответы `/agent-meetings` включают `recorder_names` — имена записавших, резолв `recorders[].telegram_id` → `user_profiles`) |
| `meeting-process` | Cron (каждую минуту; pg_cron `meetings-process` → `net.http_post` с `X-Cron-Secret`) | Swarm Meetings: **durable-воркер**. Берёт встречи в `summary_status='processing'` с незаконченными частями (лиз `processing_lease` — нет двойной обработки; протухший лиз перехватывается), двигает каждую на шаг в рамках бюджета (<400s wall-clock воркера) — что не успел, добьёт следующий тик. Heartbeat `last_progress_at`. Логика шага — общий `_shared/meeting-processor.ts` |
| `meeting-status` | HTTP GET (desktop-agent) | Swarm Meetings: статус встреч пачкой (`?ids=a,b,c` → `[{id, summary_status}]`). Рекордер держит локальный бэкап исходного аудио и удаляет его, когда встреча обработана (`summary_status='done'` → стенограмма/тезисы уже в БД), либо по 24ч-потолку. Отдаёт статус **только встреч вызывающего** (`claim_owner`) — чужие не светит. Auth — персональный токен |
| `meeting-current` | HTTP GET (desktop-agent) | Swarm Meetings: «какая встреча идёт сейчас» для рекордера. Agent-токен (`smcp_`) → `telegram_id` → `refresh_token` из `user_integrations(service='google_calendar')` → Google Calendar API (события now±30мин) → идущее событие + идентичность для claim. Рекордеру не нужен локальный доступ к календарю |
| `google-oauth` | HTTP redirect (OAuth) | Серверная Google Calendar-интеграция для рекордера (как Granola/Read.ai). `/start` редиректит на consent Google (scope `calendar.events.readonly`), `/callback` меняет код на токены и кладёт `refresh_token` в `user_integrations(service='google_calendar')`. State — подписанный JWT с `telegram_id` (выдаёт `swarm-api` `/google/connect-url`). Секреты `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` |
| `swarm-api` | HTTP (Mini App / веб) | REST API для Telegram Mini App «Рой» и браузера: задачи, спринты, зависимости, entries CRUD, поиск/RAG, встречи (`/meetings` + `/agent-meetings`), интеграции (Granola/Google), дайджест, фидбек, админка. Третий клиент поверх `_shared/tasks/db.ts`. Полный список эндпоинтов — в разделе [swarm-api — Mini App backend](#swarm-api--mini-app-backend) (канон) |

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
| `tasks` | Задачи команды + личные (Рой) | `id`, `title`, `assignees`, `due_date`, `status` (`text not null default 'open'`, **БЕЗ CHECK** — см. ниже), `tags`, `meeting_id`, `created_by`, `created_by_telegram_id`, `priority` (NULL\|`high`\|`med`\|`low`, **CHECK** `priority is null or priority in ('high','med','low')`, миграция `20260615000000`), `task_role` (NULL\|`marketing`\|`bd`\|`rnd`, **CHECK**, миграция `20260528120000`), `group_id` (FK → `workspaces.id`); модуль Рой: `is_private`, `owner_id` (FK → `allowed_users`), `start_date`, `timeline_position`, `sprint_id` (FK → `sprints`). ⚠️ `created_by_name` — **НЕ колонка**: вычисляется в слое `swarm-api` (`GET /tasks`) из `created_by_telegram_id` через `creatorMap` |
| `sprints` | Спринты (Рой) | `id`, `group_id` (FK → `workspaces.id`), `name`, `start_date`, `end_date`, `status` (`planned`\|`active`\|`completed`), CHECK `start_date<=end_date` |
| `task_dependencies` | Зависимости задач (Рой) | `id`, `task_id`, `depends_on_id` (оба FK → `tasks`), `dependency_type` (`blocks`\|`relates_to`\|`duplicates`); цикл-детекция через `get_all_dependencies()` |
| `task_history` | История изменений задач | `id`, `task_id` (FK → `tasks`, ON DELETE CASCADE), `changed_by`, `old_status`, `new_status`, `note`, `created_at` |
| `meetings` | Swarm Meetings — источник истины о встрече (НЕ путать с `entries`) | `id`, `source` (`desktop-agent`), `identity_kind` (**CHECK** `identity_kind in ('calendar','room','manual')`)/`identity_key` (дедуп; UNIQUE кроме manual), `transcript` (jsonb), `draft_notes_md` (черновик тезисов до публикации), `notes_edited_at`, `entry_id` (FK → `entries`, при публикации), `recorders` (jsonb — кто записал), `claim_owner`/`lease_expires_at` (право транскрибации), `status` (`awaiting_review`\|`in_base` — публикация), `summary_status` (`processing`\|`done`\|`failed` — фоновая транскрибация+тезисы, отдельно от `status`), `mic_start_offset` (double precision — сдвиг старта mic-дорожки относительно system в секундах, может быть <0; миграция `20260624120000` ✅ применена), `process_state` (jsonb — durable-обработка: манифест частей в Storage + накопленные сегменты + стадия `transcribe`/`summarize`), `last_progress_at` (timestamptz — heartbeat: watchdog валит в `failed` только по застою), `processing_lease` (timestamptz — лиз durable-воркера; миграция `20260626120000`), `group_id` (FK → `workspaces.id`). Личные пометки участников — отдельные приватные `entries` с `metadata.meeting_id` |
| `sessions` | Состояние диалога бота | `chat_id` (PK), `action`, `context` (jsonb), `updated_at` (TTL 30 мин) |
| `allowed_users` | Белый список | `telegram_id`, `username`, `is_admin`, `group_id` (FK → `workspaces.id`); токены (см. [MCP-аутентификация](#mcp-аутентификация)): `claude_mcp_token_hash`, `claude_mcp_token_expires_at` (MCP/Claude Desktop, бессрочный → `null`), `recorder_token_hash`, `recorder_token_expires_at` (отдельный токен рекордера, миграция `20260617120000`) |
| `user_profiles` | Профили пользователей | `telegram_id`, `first_name`, `last_name`, `role` (**CHECK** `role in ('marketing','bd','rnd')`, миграция `20260528120000`), `markets`, `phone`, `email`, `notes`, `name_aliases`. ⚠️ **`username` здесь НЕТ** — он в `allowed_users`. Имя = `first_name`+`last_name`, фолбэк на `@username` из `allowed_users` (хелпер `resolveNames` в swarm-api). Не селектить `username` из `user_profiles` — PostgREST упадёт на несуществующей колонке → `data=null` |
| `user_integrations` | API-ключи интеграций | `telegram_id`, `service` (`granola`), `api_key`, `last_polled_at`, `skipped_note_ids` |
| `app_settings` | Глобальные настройки | `key`, `value` — хранит `feedback_channel_id` |
| `oauth_tokens` | OAuth токены интеграций | `service` (`read_ai`), `client_id`, `access_token`, `refresh_token`, `expires_at`, `updated_at` |
| `oauth_state` | Временный PKCE state для OAuth | `state`, `client_id`, `code_verifier` — создаётся при старте OAuth, удаляется после callback |
| `task_comments` | Комментарии к задачам | Таблица существует, код не использует — не задействована |

### `tasks.status` — значения и целостность

⚠️ **`tasks.status` НЕ ограничен CHECK на уровне БД** (`text not null default 'open'`, `supabase/schema/00_base_schema.sql`; ни одна миграция CHECK не добавляет). БД примет **любую строку** — целостность держится только на прикладном слое. CHECK на `status` есть лишь у `sprints` (`planned`/`active`/`completed`) и `meetings` (`awaiting_review`/`in_base`), но НЕ у `tasks`.

Прикладные значения `tasks.status` (используются в swarm-bot / swarm-mcp / swarm-api):

| Значение | Смысл |
|----------|-------|
| `pending` | Ожидает подтверждения (создана, но `confirmed=false`) |
| `open` | Создана / активна (дефолт при insert) |
| `in_progress` | Взята в работу |
| `done` | Завершена |
| `cancelled` | Отклонена / отменена |
| `draft` | Несохранённый черновик |

`listTasks` по умолчанию исключает `done`/`cancelled`/`draft`. Поскольку CHECK нет — опечатка или новое значение из кода молча запишутся в БД; следить за консистентностью значений нужно в коде.

**Миграции:** начальная схема (полный набор `CREATE TABLE` в их текущем end-state) живёт в `supabase/schema/00_base_schema.sql` — фундамент изначально строился руками в дашборде Supabase, этот файл его реконструирует для bootstrap'а чистого проекта с нуля. Инкрементальные файлы в `supabase/migrations/` (по дате) в основном только `ALTER` существующие таблицы, **но не все**: таблица `meetings` (Swarm Meetings) **создаётся** миграцией `20260612000000_meetings.sql` (`CREATE TABLE`, additive). ⚠️ `00_base_schema.sql` может отставать от migrations — например, на момент ревизии в нём нет `tasks.priority`, токенов рекордера и таблицы `meetings` (они добавлены поздними миграциями).

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
  → дедуп+группировка (ТОЛЬКО source telegram|note, при groupId):
      кандидаты = ≤40 свежих записей той же видимости в воркспейсе за неделю
      1) near-identical → return {..., duplicate:true} (запись не плодим):
           точный матч по нормализации (любая длина)
           ИЛИ триграм-Жаккар ≥0.95 (только для контента >100 симв)
      2) группировка фрагментов (source telegram, тот же added_by, окно 60с):
           дописать новый текст к найденной записи + переиндексировать
           → return {..., merged:true}
      (document/pdf/voice/read_ai/digest НЕ дедупим — у документа чанки в цикле)
  → buildEntryIndex (1 GPT вызов, classifier-режим: temperature 0 + response_format json_object):
      если нет summary  → {summary, countries, entry_type, entry_date, keywords}
      если есть summary → {countries, entry_type, entry_date, keywords}  (summary not re-generated)
      правила страны/типа — из _shared/countries.ts (COUNTRY_PROMPT_RULE / ENTRY_TYPE_PROMPT_RULE),
      единый источник для swarm-bot/swarm-mcp/swarm-api (детерминизм, без якоря на одну страну)
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
claimer → meeting-ingest: грузит АУДИО (части ≤15мин → Storage) → durable-обработка по куску
  (inline-проход в ingest + cron meeting-process, переживает wall-clock) → meetings.transcript
  → async GPT-тезисы → meetings.draft_notes_md (общий черновик, НЕ в базе знаний/поиске)
  → уведомление записавшим «готово к вычитке»
  локальный бэкап аудио в рекордере НЕ удаляется на 202 — живёт до summary_status='done'
  (опрос meeting-status) или до 24ч-потолка (UploadQueue); защита от потери при сбое обработки
вычитка (PATCH /agent-meetings/:id) + аппрув (POST /agent-meetings/:id/publish):
  создаётся entries (выбор базы: воркспейс/личное), эмбеддинг, status=in_base.
  Один объект → из «на вычитке» уходит у всех разом
```
**Эндпоинты swarm-api (вызывает веб/Mini App, auth — сессия роя):** `GET /agent-meetings?status=` (очередь вычитки/опубликованные; видны записавшим или админу), `GET /agent-meetings/:id` (черновик + транскрипт), `PATCH /agent-meetings/:id` (правка `draft_notes_md` → `notes_edited_at`), `POST /agent-meetings/:id/publish` (`{base: workspace|personal}` → создать entries, привязать, идемпотентно).

Дедуп нескольких записавших — по `meetings.identity_key` (calendar/room; manual без дедупа, дубли — ручным «объединить»). Аутентификация агента — персональный токен (`_shared/agent-auth.ts`, личность из токена, не из payload). Фильтры источников включают `desktop-agent` (swarm-api `GET /meetings`, MCP `get_meetings`, бот `rai_saved`).

**Веб (miniapp):** `MeetingReview` — страница вычитки одной встречи (тезисы редактируются, транскрипт под спойлером, участники, публикация с выбором базы команда/личное); `AgentReviewQueue` — очередь «на вычитке» в разделе Встречи (невидима без черновиков). Deep-link из уведомления: `?meeting=<id>` (браузер) / `startapp=meeting_<id>` (Mini App) → `getDeepLinkMeetingId()` в `lib/telegram.ts` открывает вычитку. **Дедуп вкладок/окон** (Telegram Desktop открывает ссылку новой вкладкой каждый раз): `lib/single-tab.ts` + `SingleTabGate` (в `layout.tsx`) — новая вкладка с `?meeting=` через `BroadcastChannel` + `navigator.locks` (лидер `swarm-leader`) отдаёт встречу уже открытой вкладке и закрывается; установленный PWA через `launch_handler: focus-existing` + `handle_links` в манифесте ловит ссылку в существующее окно (`window.launchQueue`). Обе ветки → событие `roy:open-meeting` → `openMeeting(id)` в `RoyApp`. Спек: `docs/superpowers/specs/2026-06-17-single-tab-reuse-design.md`.

**Статус:** **задеплоено на прод** (`vbqglndbxkpmreccpqmr`) — таблица `meetings` (через `apply_migration`: `supabase db push` нельзя, история миграций дрифтит — локальные файлы и remote-записи расходятся по таймстампам) + функции `meeting-claim`/`meeting-ingest`/`swarm-api`/`swarm-mcp`/`swarm-bot`. Smoke-тест auth зелёный (нет/невалидный токен → 401). Осталось: ~~`WEB_BASE_URL`~~ ✅ выставлен (`https://swarm-brain.pages.dev`) — в уведомлении «тезисы готовы» теперь есть кнопка «Открыть» на `/?meeting=<id>`; веб-страница уезжает на прод через Cloudflare Pages (зависит от ветки CF — push в `sandbox_vas` сделан); полный e2e с реальным `smcp_`-токеном; ~~экстракция задач при публикации~~ ✅ при публикации (`POST /agent-meetings/:id/publish`) тезисы прогоняются через `createMeetingTasks` (GPT-4o-mini → `createTask` с привязкой `meeting_id`, резолвом исполнителей по имени и наследованием приватности базы; сбой извлечения не валит публикацию); агент — **свой лёгкий рекордер** (Swift/ScreenCaptureKit) — **написан** (`recorder/`, собирается `swift build -c release`): двухдорожечный захват, `UploadQueue` (персист+ретрай, защита от потери записи), silence-watchdog, jitter/Retry-After, живой уровень звука. **Установка одной командой из бота:** `/recordertoken` → `curl … | bash` (edge-fn `swarm-recorder-setup` + `recorder/setup-signing.sh` для стабильного TCC; клон `--branch sandbox_vas`). Задеплоено: `swarm-recorder-setup`, `swarm-bot`, `meeting-claim`, `meeting-ingest`, `meeting-process`. **Durable-обработка длинных встреч** ✅: аудио-части в Storage (`meeting-audio`), cron `meeting-process` (каждую минуту) транскрибирует по куску и переживает wall-clock воркера; рекордер режет дорожки ≤15 мин; watchdog валит в `failed` только по застою `last_progress_at` (миграция `20260626120000`: `process_state`/`last_progress_at`/`processing_lease`). Миграция `mic_start_offset` (`20260624120000`) ✅ применена. Авто-стоп рекордера по концу созвона (тишина системной дорожки) ✅. Транскрибация/тезисы — облако OpenAI. Остаётся: e2e-приёмка реального длинного звонка после реинстала рекордера.

---

## Сессионный механизм

Хранится в таблице `sessions` (`chat_id` → `{action, context, updated_at}`). Один активный сеанс на chat_id. TTL = 30 мин: `getSession` удаляет запись если `updated_at` старше 30 мин. `/reset` очищает сессию явно.

| Prefix action | Файл | Описание |
|--------------|------|---------|
| `waiting_add` | index.ts | Ожидание текста для /add |
| `waiting_ask` | index.ts | Ожидание вопроса для /ask |
| `last_answer` | knowledge.ts | Кэш последнего ответа (context = текст ≤800 симв) для уточняющих вопросов: set ~923 после ответа, read ~758 как `prevAnswer` |
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
| `addtask_title` | tasks/handlers.ts | Wizard `/addtask`: ожидание названия задачи |
| `addtask_due` | tasks/handlers.ts | Wizard `/addtask`: ожидание дедлайна (по завершении — `confirmed:true` + `broadcastTaskAssigned`) |
| `task_date` | tasks/handlers.ts | Ожидание нового дедлайна (правка существующей задачи / из pending-карточки) |
| `task_rename` | tasks/handlers.ts | Ожидание нового названия задачи |
| `onboard_role` | users.ts | Онбординг нового пользователя: ожидание роли (далее `onboard_markets` → `onboard_email` → `onboard_phone`; каждый шаг можно пропустить кнопкой `onboard_skip_<step>`) |
| `onboard_markets` | users.ts | Онбординг: ожидание рынков |
| `onboard_email` | users.ts | Онбординг: ожидание email |
| `onboard_phone` | users.ts | Онбординг: ожидание телефона |
| `profile_<targetId>_<field>` | users.ts | Редактирование поля профиля пользователя (`/users` → ✏️ Редактировать) — ожидание нового значения поля |
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
| `rai_saved` | Список сохранённых встреч (read_ai/voice/desktop-agent + meeting/transcript) |
| `rai_import` | Импорт встреч за окно 48ч (→ `handleMeetings`) |
| `rai_connect` | Подключение Read.ai (→ `handleConnect`) |
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
| `tk_team` | Командные задачи (список) |
| `tk_add` | Создать задачу (запускает addtask сессию) |
| `tk_t_<taskId>` | Детали задачи |
| `tk_st_<taskId>_<status>` | Сменить статус задачи |
| `tk_del_<taskId>` | Запрос подтверждения удаления |
| `tk_delc_<taskId>` | Подтвердить удаление задачи |
| `tl_<type>` | Меню списков задач (`tl_pending`/`tl_done`/`tl_export` и др.) → `handleTaskListCallback` |
| `tc_<taskId>` | Подтвердить pending-задачу: `confirmed=true`, `status=open`, отправить Telegram-уведомления исполнителям |
| `tdue_<taskId>` | Ввод нового дедлайна в свободной форме (из pending-карточки) |
| `tdate_<taskId>` | Запросить новый дедлайн (формат ДД.ММ.ГГГГ / «убрать») — сессия `task_date` |
| `tren_<taskId>` | Переименовать задачу — сессия `task_rename` |
| `tctag_<taskId>` | Открыть пикер страны и тегов |
| `tctagc_<taskId>:<country\|none>` | Установить страну задачи |
| `tctagr_<taskId>:<tag>` | Переключить тег задачи (toggle) |
| `ts_<taskId>_<status>` | Сменить статус задачи + запись в `task_history` (`changed_by`/`old_status`/`new_status`) |
| `ta_<taskId>` | Показать кнопки выбора исполнителя |
| `tas_<taskId>_<tgId>` | Назначить исполнителя (`status=open`) |
| `tat_<taskId>_<tgId>` | Wizard `/addtask`: исполнитель выбран → показать пикер рынка |
| `tac_<taskId>:<index\|none>` | Wizard `/addtask`: выбор страны → перейти к дедлайну (сессия `addtask_due`) |
| `tacx_<taskId>` | Wizard `/addtask`: отмена создания (удаляет черновик задачи) |
| `tdc_<taskId>` | Запрос подтверждения удаления задачи (карточка) |
| `tdconf_<taskId>` | Подтвердить удаление задачи |
| `tdcanc_<taskId>` | Отменить удаление задачи |

### Users (управление командой, `/users` → `handleUserCallbacks`)
| Код | Действие |
|----|---------|
| `ua_list` | Список участников воркспейса |
| `ua_add` | Подсказка как добавить пользователя (`/users add @username`) |
| `start_onboard` | Запустить онбординг нового пользователя (шаг 1/4 — роль) |
| `onboard_skip_<field>` | Пропустить шаг онбординга (`role`/`markets`/`email`/`phone`) → переход к следующему шагу или завершение на `phone` |
| `pu_<targetId>` | Профиль пользователя (карточка) |
| `pe_menu_<targetId>` | Меню «что изменить» в профиле |
| `pe_<targetId>_<field>` | Начать правку поля профиля → сессия `profile_<targetId>_<field>` |
| `ptasks_<targetId>` | Активные командные задачи пользователя |
| `udel_<targetId>` | Запрос подтверждения удаления пользователя (нет для `ADMIN_USER_ID`) |
| `udelc_<targetId>` | Подтвердить удаление пользователя из `allowed_users` |

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
- ⚠️ **`/mytoken` не перевыпускает молча**: если живой токен уже есть (`hasActiveMcpToken`), бот предупреждает и просит подтверждения кнопкой `mtk_reissue` (callback, обрабатывается в `swarm-bot/index.ts` ~134; кнопка генерится ~417) — экстренный перевыпуск токена, иначе случайный `/mytoken` убил бы рабочий `config.json`. `/setup` минтит всегда (ему нужен plaintext для команды) и сам же переписывает config, поэтому самосогласован
- Отзыв: `/revoketoken` в боте или `SELECT revoke_mcp_token(<telegram_id>)` (гасит хэш + срок)
- ⚠️ В `claude_desktop_config.json` использовать только stdio-форму (`command`+`mcp-remote`); поле `url`/`type:http` Claude Desktop молча затирает весь `mcpServers` (anthropics/claude-code#37286)

**Доступ при выходе коннектора в орг-список Claude:**
Орг-список управляет только видимостью коннектора, не доступом к данным. Шлюз — токен:
- В soft-режиме (`MCP_AUTH_REQUIRED` не выставлен) `requesting_user_id` берётся из аргументов **на доверии** → любой член орга читает всё. **Перед публикацией в орг обязательно `MCP_AUTH_REQUIRED=true`.**
- В strict-режиме доступ есть только у владельцев валидного `smcp_`-токена; нежелательные члены орга получают `401`. Даже владелец токена видит лишь свой `group_id` и свои приватные записи.

Ошибка при невалидном/отсутствующем токене: JSON-RPC -32001 "Unauthorized".

---

## Переменные окружения

Канонический список — таблица ниже. Покрывает Supabase Edge Functions (секреты `supabase secrets set`), Cloudflare Pages Functions (`miniapp/functions/*`, задаются в дашборде CF) и сборочные `NEXT_PUBLIC_*` Mini App. Потребители выверены `grep` по `Deno.env.get(...)` / `env.*` / `NEXT_PUBLIC_*`.

### Supabase Edge Functions (секреты)

| Переменная | Где используется (функции) | Обязательная | Назначение |
|-----------|---------------------------|-------------|-----------|
| `SUPABASE_URL` | все функции (через `_shared`) | да | URL проекта Supabase для клиента |
| `SUPABASE_SERVICE_ROLE_KEY` | все функции (через `_shared`) | да | Service-role ключ; RLS обходится, фильтрация в коде |
| `OPENAI_API_KEY` | swarm-bot, swarm-mcp, swarm-api, meeting-claim, meeting-ingest, meeting-process, read-ai-webhook | да | OpenAI: chat (GPT-4o-mini), embeddings, Whisper-транскрибация |
| `TELEGRAM_BOT_TOKEN` | swarm-bot, swarm-api, swarm-mcp, meeting-ingest, meeting-process, read-ai-webhook, granola-poller (legacy) | да | Telegram Bot API: отправка сообщений/уведомлений; проверка подписи Mini App initData (swarm-api) |
| `BOT_NAME` | swarm-bot (feedback) | нет, дефолт `"bot"` | Префикс `[BOT_NAME]` в пересланном фидбеке (одна группа на несколько ботов) |
| `MCP_AUTH_REQUIRED` | swarm-mcp | нет | `true` = жёсткий режим (без валидного `smcp_`-токена — отказ); не выставлен = soft-режим на доверии. **Перед орг-публикацией обязательно `true`** |
| `CRON_SECRET` | swarm-bot, meeting-process, granola-poller (legacy) | нет | Общий секрет для авторизации cron-вызовов (`X-Cron-Secret`): Granola-поллинг/watchdog (swarm-bot), durable-обработка встреч (meeting-process) |
| `INITDATA_MAX_AGE` | swarm-api | нет, дефолт 24ч | TTL свежести `auth_date` в Telegram Mini App initData (секунды) |
| `MINIAPP_ORIGIN` | swarm-api | нет | Разрешённый Origin для CORS Mini App |
| `WEB_JWT_SECRET` | swarm-api, google-oauth | да (для веб-режима/Google) | HS256-секрет: проверка `Bearer`-JWT браузерной сессии (swarm-api) и подписанного OAuth-state (google-oauth `/google/connect-url`). Должен совпадать с CF Pages |
| `WEB_BASE_URL` | google-oauth, meeting-ingest, meeting-process | да (для deep-link/OAuth-redirect) | База веб-фронта (`https://swarm-brain.pages.dev`): кнопка «Открыть» `?meeting=<id>` в уведомлении (meeting-process/ingest), redirect после Google OAuth (google-oauth) |
| `GOOGLE_CLIENT_ID` | google-oauth, meeting-current | да (для Google Calendar рекордера) | OAuth client id серверной Google Calendar-интеграции |
| `GOOGLE_CLIENT_SECRET` | google-oauth, meeting-current | да (для Google Calendar рекордера) | OAuth client secret той же интеграции (обмен кода / рефреш токена) |
| `GOOGLE_CLIENT_EMAIL` | swarm-bot (`lib/drive.ts`) | нет (для Google Drive) | Service-account email: JWT-issuer для Google Drive (загрузка файлов) |
| `GOOGLE_PRIVATE_KEY` | swarm-bot (`lib/drive.ts`) | нет (для Google Drive) | Приватный ключ того же service-account (подпись JWT; `\n` разэкранируются) |
| `GOOGLE_DRIVE_FOLDER_ID` | swarm-bot (`lib/drive.ts`) | нет (для Google Drive) | Корневая папка Drive для авто-создаваемых подпапок/файлов |
| `READ_AI_CLIENT_ID` | read-ai-auth | да (для Read.ai OAuth) | OAuth client id Read.ai (авторизация в `read-ai-auth`) |
| `READ_AI_WEBHOOK_SECRET` | read-ai-webhook | да (для Read.ai webhook) | Секрет проверки входящего вебхука Read.ai |

> Примечание: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (OAuth-интеграция календаря рекордера) и `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_DRIVE_FOLDER_ID` (service-account для Google Drive) — **разные** механизмы Google, не путать.

### Cloudflare Pages Functions (`miniapp/functions/*`, дашборд CF)

| Переменная | Где используется | Обязательная | Назначение |
|-----------|----------------|-------------|-----------|
| `SWARM_API_URL` | `api/[[path]].ts` | да | Целевой URL swarm-api для прокси-форварда (`/api/*` → swarm-api) |
| `WEB_JWT_SECRET` | `api/auth/telegram.ts`, `_lib/jwt.ts` | да | HS256-секрет выдачи/проверки браузерного JWT (тот же, что в Supabase) |
| `TELEGRAM_BOT_TOKEN` | `api/auth/telegram.ts` | да | Проверка подписи Telegram Login Widget (тот же, что в Supabase) |

### Mini App build-time (`NEXT_PUBLIC_*`)

| Переменная | Значение | Назначение |
|-----------|---------|-----------|
| `NEXT_PUBLIC_API_URL` | `/api` (прокси) или прямой URL swarm-api | База API; `/api` → same-origin прокси через CF Pages Function (вариант B+) |
| `NEXT_PUBLIC_BOT_USERNAME` | напр. `swarm_brain_bot` (без `@`) | Username бота для Telegram Login Widget |
| `NEXT_PUBLIC_DEV_MODE` | `true` / `false` | `true` — мок-данные без бэкенда (локальная разработка UI) |

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

**Эндпоинты (канон — другие документы ссылаются сюда):**

_Профиль / воркспейс:_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/me` | `{ telegram_id, name, group_id, language, role, markets, is_admin }` |
| `PATCH` | `/me` | Правка профиля текущего пользователя: `role`, `markets` (нормализуются) в `user_profiles`; 204 |
| `GET` | `/config` | `{ allowed_markets: string[] }` — ISO коды рынков воркспейса (из `workspaces.allowed_markets`, или глобальный список) |
| `GET` | `/users` | Участники воркспейса с профилями |

_Задачи / спринты / зависимости:_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/tasks` | Список задач. Фильтры: `status`, `country`, `assignee`, `mine`, `limit`, `confirmed`, `sprint_id`, `tags` (csv, ANY), `start_date_from/to`, `due_date_from/to`. **Приватность:** приватные задачи видны только владельцу (админ — все). Дополняется вычисляемым `created_by_name` (из `created_by_telegram_id`) |
| `GET` | `/tasks/:id` | Одна задача. Приватная чужая → 404 |
| `POST` | `/tasks` | Создать (`assignee_telegram_id` → имя); поля Роя: `is_private` (→`owner_id`), `start_date`, `sprint_id`, `tags`, `timeline_position`; валидация `start_date<=due_date` и принадлежности спринта воркспейсу; `confirmed=true` |
| `PATCH` | `/tasks/:id` | Частичный апдейт. Приватную чужую → 404, мутация приватной не владельцем → 403. Поддержаны новые поля + смена `is_private`, привязка к спринту |
| `DELETE` | `/tasks/:id` | Удалить (204). Приватную чужую → 404/403 |
| `POST` | `/tasks/extract` | Извлечь задачи из текста через GPT-4o-mini. `{ save:false }` → **preview**: вернуть предложенные задачи БЕЗ создания (≤10, ревью на экране встреч). Без `save:false` (по умолчанию) — старое поведение: создать задачи и вернуть |
| `GET` | `/dependencies` | Bulk: все рёбра зависимостей воркспейса одним запросом (граф, без N+1). Изоляция+приватность: ребро видно только если оба конца видимы вызывающему |
| `GET` | `/tasks/:id/dependencies` | Зависимости задачи (incoming + outgoing) |
| `POST` | `/tasks/:id/dependencies` | Создать `{ depends_on_id, dependency_type }`; self→400, цикл→422, дубль→409 |
| `DELETE` | `/tasks/:id/dependencies/:depId` | Удалить зависимость (204) |
| `GET` | `/sprints` | Спринты воркспейса (все участники) |
| `POST` | `/sprints` | Создать спринт (`name`, `start_date`, `end_date`, `status`) — **только admin** |
| `PATCH` | `/sprints/:id` | Обновить спринт — только admin |
| `DELETE` | `/sprints/:id` | Удалить (задачи освобождаются, FK SET NULL) — только admin |
| `POST` | `/sprints/:id/tasks` | Привязать задачи `{ task_ids }` (только командные) |
| `DELETE` | `/sprints/:id/tasks` | Отвязать задачи `{ task_ids }` |

_Записи базы знаний (entries — только через `entries-guard.ts`):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/entries` | Список заметок (`entry_type=note`, без `source=digest`). Фильтры: `source`, `type`, `date_from/to`; ≤50, по `created_at desc`. Воркспейс+приватность через `buildEntriesQuery` |
| `GET` | `/entries/:id` | Одна запись (`getEntrySecure`). Приватная чужая / несуществующая → 404 |
| `PATCH` | `/entries/:id` | Правка `content`/`summary` — **только владелец** (`requireOwner`) |
| `DELETE` | `/entries/:id` | Удалить запись + прикреплённый файл из Storage (`swarm_drive`) — только владелец; 204 |
| `POST` | `/entries` | Создать заметку из текста: эмбеддинг + классификация стран/типа (GPT-4o-mini, `COUNTRY_PROMPT_RULE`/`ENTRY_TYPE_PROMPT_RULE`) + тезисы (если ≥80 симв); `source=note`, привязка `group_id`/`owner_id`; 201 |
| `POST` | `/entries/upload` | Multipart-загрузка файла в Storage (`swarm_drive/uploads/`) + создание записи (`source=file`, `metadata.file_url`); `is_private` опц.; 201 |

_Встречи — `/meetings` (подтверждённые записи-встречи в `entries`):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/meetings` | Записи-встречи (`entry_type=meeting`). `?confirmed=true/false` фильтрует по `metadata.confirmed` (очередь «на согласовании») |
| `GET` | `/meetings/:id` | Одна встреча-запись (`getEntrySecure`) |
| `PATCH` | `/meetings/:id` | Правка: `confirmed` (в `metadata`), `summary`, `content`, `entry_type` (реклассификация «встреча → заметка», уводит из очереди), `is_private` (+`owner_id` как у задач), `countries` |
| `DELETE` | `/meetings/:id` | Удалить встречу-запись (204) |

_Встречи — `/agent-meetings` (черновики рекордера в таблице `meetings` до публикации):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/agent-meetings` | Очередь вычитки / опубликованные (`?status=awaiting_review\|in_base`). Видны записавшим (`recorders`) или админу |
| `GET` | `/agent-meetings/:id` | Черновик `draft_notes_md` + транскрипт |
| `PATCH` | `/agent-meetings/:id` | Правка `draft_notes_md` → `notes_edited_at` (и/или `title`) |
| `DELETE` | `/agent-meetings/:id` | Удалить черновик (до публикации) |
| `POST` | `/agent-meetings/:id/publish` | Аппрув: `{ base: workspace\|personal }` → создать `entries` + эмбеддинг, привязать, `createMeetingTasks` (извлечение задач), `status=in_base`; идемпотентно |

_Интеграции (per-user):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/integrations` | Подключённые интеграции пользователя (`service`, `last_polled_at`, `skipped_note_ids`) |
| `GET` | `/google/connect-url` | Подписанная OAuth-ссылка для подключения Google-календаря (state = JWT с `telegram_id`, ведёт в `google-oauth`) |
| `DELETE` | `/integrations/google` | Отключить Google-календарь (удаляет `user_integrations(service='google_calendar')`); 204 |
| `POST` | `/integrations/granola` | Подключить Granola: валидирует `api_key` против Granola API → upsert в `user_integrations`; 204 |
| `DELETE` | `/integrations/granola` | Отключить Granola; 204 |
| `GET` | `/granola/notes` | Необработанные заметки Granola за период (`?period=today\|7d\|30d`), минус skipped и уже импортированные |
| `GET` | `/granola/notes/:id/preview` | Превью одной заметки Granola с тезисами |
| `POST` | `/granola/notes/:id/import` | Импортировать заметку Granola в `entries` |
| `POST` | `/granola/notes/:id/skip` | Пометить заметку Granola как пропущенную (`skipped_note_ids`); 204 |

_Поиск / RAG / прочее:_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/search?q=` | Семантический поиск по `entries` (вектор `match_entries`, threshold 0.3) → `Entry[]` |
| `POST` | `/ask` | RAG-ответ (экран Answer редизайна): embed → `matchEntries` (топ-8, приватность+воркспейс в RPC) → GPT-4o-mini синтез строго по источникам со сносками `[n]` → `{ query, answer, sources[], followups[] }`. Пусто → без GPT; сбой синтеза → деградация до источников |
| `POST` | `/digest` | Персональный дайджест за период (`{ days }`, дефолт 7): GPT-сводка по `entries` воркспейса (приватность учтена); пусто → текстовая заглушка |
| `POST` | `/feedback` | Сохранить фидбек (`text`) в `feedback` (username из `allowed_users`) + переслать в Telegram-канал `feedback_channel_id`; 204 |

_Админка (`admin.ts`, только `telegram_id 744230399`):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/admin/workspaces` | Список воркспейсов с user_count |
| `GET` | `/admin/workspaces/:id/users` | Пользователи воркспейса |
| `POST` | `/admin/workspaces/:id/users` | Добавить пользователя |
| `DELETE` | `/admin/workspaces/:id/users/:uid` | Удалить пользователя |
| `PATCH` | `/admin/workspaces/:id` | Обновить name/allowed_markets |

**Переменные окружения:** канон — раздел [Переменные окружения](#переменные-окружения). Для swarm-api: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `MINIAPP_ORIGIN`, `INITDATA_MAX_AGE` (опц.), `WEB_JWT_SECRET` (веб-режим/Google connect-url).

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
| `reindex_entry` | Перечитать запись и пересчитать страны + embedding через GPT (для записей с пустыми/неверными странами или устаревшим embedding) |
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
- **IA**: `RoyApp.tsx` — 4 корневых таба + push-стек деталей вместо плоских секций/модалок; аватар-меню «Ещё» (Настройки/Команда/Админ — `Админ` только если `me.is_admin`). **Адаптив:** мобайл — аватар в шапке + нижний таб-бар (`RoyTabBar`); десктоп (lg+) — **дашборд-центричный, без боковой панели** (sidebar нет — `RoySidebar` в коде отсутствует). Навигация по второстепенным разделам — через то же меню «Ещё» (аватар внизу слева). Домашняя вкладка «Поиск» на десктопе — **бенто-дашборд `RoyDashboard`** во всю ширину (≤1240px): поиск-герой сверху + три панели сразу (Задачи крупно слева на всю высоту, Встречи и База справа), каждая скроллится внутри себя и раскрывается в полную вкладку по клику на шапку; на мобайле — `SearchScreen`. Вкладка «Задачи» на десктопе → полный `TasksScreen` с видами Список/Таймлайн/Спринт/Граф; дефолт — **«Список»** в стиле macOS Reminders (смарт-списки Сегодня/Предстоящее/Важное/Все/Готово/По рынкам, линза Мои/Все, бинарный чекбокс), общий с мобайлом через `useReminderTasks`. Канбан остался только в «Спринте». Deep-link встреч и приватность сохранены.
- **Экраны** (`screens/`): `SearchScreen` (герой), `AnswerScreen` (RAG `/ask`: ответ со сносками + источники + «Уточнить»), `RoyTasksScreen` + `TaskDetail` + `NewTask` (поле `priority`), `RoyBaseScreen` + `RecordDetail` + `NewEntry`, `RoyMeetingsScreen` + `MeetingDetail` (вычитка `AgentReviewQueue`/`MeetingReview` и подтверждение/правка/удаление сохранены).
- **Бэкенд под редизайн**: `POST /ask` (RAG), колонка `tasks.priority` (миграция `20260615000000`). Спецификация — `transcribator/08-UI-UX-V2.md` + `design_handoff_roy/`.
- **Хвосты (не блокеры):** визуальная очная проверка десктопа в Telegram; чистка осиротевших старых компонентов (`BottomNav`/`Sidebar`/`KnowledgeScreen`/`MeetingsScreen`/`TaskCard`/`TaskModal`/`*Dialog` — больше не используются `RoyApp`, но `TasksScreen`+виды задач используются на десктопе); бэкенд-расширения из хендоффа (человеческий `title` записи, связь task↔entry) — по желанию.

**Переменные окружения Mini App:** канон — раздел [Переменные окружения](#переменные-окружения) (подразделы «Cloudflare Pages Functions» и «Mini App build-time»). Кратко: `NEXT_PUBLIC_API_URL` (`/api` прокси или прямой URL swarm-api), `NEXT_PUBLIC_BOT_USERNAME`, `NEXT_PUBLIC_DEV_MODE`; серверные CF-секреты `SWARM_API_URL`, `WEB_JWT_SECRET`, `TELEGRAM_BOT_TOKEN`.

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
- ⚠️ `granola-poller` — legacy, **не деплоить** как обычный шаг: standalone-функция выведена из крона. Поллинг Granola идёт внутри `swarm-bot` (часовой крон с `{granola_poll:true}` → `ingestNewGranolaNotesAllUsers`). См. таблицу Edge Functions выше.
- Деплой Mini App: `cd miniapp && npm run build` → `out/` → Cloudflare Pages
- После каждого изменения функционала: обновить этот файл (ARCHITECTURE) + `docs/BACKLOG.md`. **Changelog руками не вести** — генерируется из git (`scripts/changelog.sh`); источник истины — conventional commit-сообщения.
