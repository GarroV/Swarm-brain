# Swarm Brain

Командная база знаний с AI-поиском и интеграцией митингов. Доступна из Telegram, веб/Mini App, Claude Desktop и macOS-рекордера встреч; живёт на Supabase Edge Functions.

---

## Цель проекта

Собрать в одном месте всё, что знает команда — заметки, документы, договорённости, итоги встреч, ссылки — и сделать эту информацию мгновенно доступной через естественный язык. Бот работает там, где команда уже общается (Telegram), не требует переключения контекста.

---

## Поверхности

Все входные точки поверх одного бэкенда (Supabase Edge Functions + Postgres/pgvector + OpenAI). Подробности — **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (разделы «Поверхности продукта» и «Сквозные сценарии»).

| Поверхность | Доступ | Бэкенд-функция |
|-------------|--------|----------------|
| Telegram-бот | команды и сообщения в чате | `swarm-bot` |
| Веб / Mini App «Рой» | в Telegram (`initData`) или браузер (Login Widget → JWT) | `swarm-api` |
| Claude Desktop (MCP) | MCP-сервер по токену из `/setup` | `swarm-mcp` |
| SwarmRecorder | macOS меню-бар приложение по токену из `/recordertoken` | `meeting-claim`, `meeting-ingest` |
| Read.ai | OAuth2 + webhook (завершённые встречи) | `read-ai-auth`, `read-ai-webhook` |
| Granola | API-ключ на пользователя (`/connect granola`), часовой поллинг | `swarm-bot` (`granola_poll`) |

---

## Развернуть с нуля

Полная пошаговая инструкция — в **[docs/SETUP.md](docs/SETUP.md)**.

Кратко: Supabase проект → схема из `supabase/migrations/` → secrets → `supabase functions deploy` → Telegram webhook.

---

## Технический стек

| Слой | Технология |
|------|-----------|
| Runtime | Deno (Supabase Edge Functions) |
| База данных | Supabase (PostgreSQL + pgvector) |
| Хранилище файлов | Supabase Storage (bucket: `swarm_drive`) |
| AI | OpenAI GPT-4o-mini, Whisper, text-embedding-3-small |
| Интерфейс | Telegram Bot API + веб/Mini App (Next.js 16, React 19) |
| Веб-бэкенд | `swarm-api` (REST поверх Edge Functions), хостинг Cloudflare Pages |
| Рекордер | macOS, Swift + ScreenCaptureKit + AVFoundation (меню-бар приложение) |
| Митинги | Read.ai (OAuth2 + webhook), Granola (API key per user), SwarmRecorder (свой macOS-рекордер) |

---

## Структура проекта

```
supabase/
├── functions/
│   ├── swarm-bot/              # Telegram-бот (основной)
│   │   ├── index.ts            # Роутинг: сообщения, callback-кнопки, cron-триггеры
│   │   ├── lib/
│   │   │   ├── supabase.ts     # Supabase клиент + ADMIN_USER_ID
│   │   │   ├── telegram.ts     # sendMessage, sendInlineMessage, buildKeyboard
│   │   │   ├── openai.ts       # getEmbedding, chatComplete, transcribeAudio
│   │   │   ├── storage.ts      # saveEntry, getSession, setSession, visibilityFilter
│   │   │   ├── readai.ts       # Read.ai OAuth токены
│   │   │   └── types.ts        # TgMessage, TgCallbackQuery, KbEntry
│   │   ├── handlers/
│   │   │   ├── knowledge.ts    # /add, /ask + AI поиск с tool-calling
│   │   │   ├── media.ts        # Голос (Whisper), файлы, фото (Vision), URL
│   │   │   ├── meetings.ts     # /meetings — инбокс для Read.ai и Granola
│   │   │   ├── granola.ts      # /granola — ручной импорт + tezises preview
│   │   │   ├── users.ts        # /users — управление командой и профилями
│   │   │   ├── digest.ts       # Еженедельный дайджест
│   │   │   └── help.ts         # Текст /help
│   │   └── tasks/
│   │       ├── index.ts        # /tasks, /addtask, smartTaskSearch
│   │       ├── handlers.ts     # Callback-обработчики задач
│   │       ├── db.ts           # CRUD задач
│   │       ├── formatter.ts    # Форматирование вывода задач
│   │       ├── matcher.ts      # TASK_KEYWORDS regex
│   │       ├── types.ts        # Task types
│   │       └── tools.ts        # MCP-совместимые инструменты задач
│   ├── swarm-mcp/              # MCP-сервер для Claude Desktop (JSON-RPC)
│   ├── swarm-api/              # REST API для веб/Mini App (поверх той же логики, что и бот)
│   ├── meeting-claim/          # Рекордер: claim/lease встречи до транскрибации
│   ├── meeting-ingest/         # Рекордер: приём аудио → Whisper → тезисы
│   ├── granola-poller/         # LEGACY / DEPRECATED: standalone-поллер, выведен из крона (только слал уведомление, ничего не клал в БД). Поллинг Granola теперь внутри swarm-bot — см. ingestNewGranolaNotesAllUsers
│   ├── read-ai-auth/           # OAuth2 авторизация Read.ai
│   └── read-ai-webhook/        # Вебхук: приём встреч из Read.ai → /meetings
└── migrations/
    ├── 20260519_tasks_columns.sql
    ├── 20260521_app_settings.sql
    ├── 20260522_user_integrations.sql
    └── 20260525_private_space.sql

miniapp/                        # Веб / Telegram Mini App «Рой» (Next.js 16 → статический экспорт → Cloudflare Pages)
└── src/                        # Поиск/RAG, доска задач, база знаний, вычитка встреч

recorder/                       # SwarmRecorder — macOS меню-бар рекордер встреч (Swift)
└── Sources/SwarmRecorder/      # запись звонка (2 дорожки) → meeting-claim/ingest
```

---

## Таблицы БД

Краткий справочник (16 таблиц). Полная схема БД с ключевыми полями — **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (раздел «Таблицы БД»), единственный источник истины.

| Таблица | Назначение |
|---------|-----------|
| `workspaces` | Воркспейсы (тенанты) |
| `entries` | База знаний — все записи (встречи и заметки) |
| `tasks` | Задачи команды + личные (Рой) |
| `sprints` | Спринты (Рой) |
| `task_dependencies` | Зависимости задач (Рой) |
| `task_history` | История изменений задач |
| `task_comments` | Комментарии к задачам (таблица есть, код не использует) |
| `meetings` | Swarm Meetings — источник истины о встрече рекордера (НЕ путать с `entries`) |
| `sessions` | Состояние диалога бота (TTL 30 мин) |
| `allowed_users` | Белый список Telegram-аккаунтов + токены MCP/рекордера |
| `user_profiles` | Профили: имя, роль, рынки, контакты, алиасы |
| `user_integrations` | API-ключи интеграций (Granola) |
| `app_settings` | Глобальные настройки |
| `oauth_tokens` | OAuth токены интеграций (Read.ai) |
| `oauth_state` | Временный PKCE state для OAuth |
| `feedback` | Фидбек пользователей |

---

## Команды бота

Полный список команд роутера `swarm-bot` (25). Часть команд в меню Telegram (`setMyCommands`) не выводится — они доступны вводом вручную или из `/help`.

| Категория | Команды |
|-----------|---------|
| Знания | `/add` — добавить запись · `/ask` — задать вопрос · `/status` — состояние базы |
| Встречи | `/meetings` — инбокс на подтверждение · `/granola` — ручной импорт Granola · `/connect granola <ключ>` — подключить Granola · `/disconnect granola` — отключить |
| Задачи | `/tasks` — активные задачи (фильтры по имени/стране) · `/addtask` — создать задачу |
| Команда | `/users` — управление командой и профилями |
| Claude Desktop | `/setup` — авто-подключение (one-liner) · `/connect_claude` — инструкция по подключению · `/claude` — инструкции для проекта · `/mytoken` — выдать MCP-токен · `/revoketoken` — отозвать MCP-токен |
| Рекордер | `/recordertoken` — токен SwarmRecorder · `/revokerecordertoken` — отозвать токен рекордера |
| Администратор | `/superadmin` — панель супер-админа · `/workspace` — управление воркспейсами · `/broadcast` — рассылка команде |
| Утилиты | `/start` — главное меню · `/help` — справка · `/reset` — сбросить состояние · `/feedback` — отправить фидбек · `/digest` — личный дайджест |

---

## Функциональность

### База знаний
- **Добавление** — текст, ссылки, документы (TXT, MD, CSV, JSON, XLSX, PDF), фото, голосовые
- **Семантический поиск** — векторные эмбеддинги (text-embedding-3-small) + keyword fallback
- **AI-ответы** — GPT-4o-mini с tool-calling: ищет по базе, отвечает на русском
- **Автообработка** — голос → Whisper → текст, фото → Vision → описание, URL → парсинг страницы
- **Приватные записи** — `is_private: true` + `owner_id`: видны только владельцу. Работает в Telegram и Claude Desktop

### /meetings — единый инбокс встреч
- Все встречи из Read.ai и Granola попадают сюда с `confirmed: false`
- Список неподтверждённых встреч с датами и источниками (📹 Read.ai / 📓 Granola)
- По каждой встрече: тезисы, ✅ Подтвердить, ✏️ Тезисы, ✏️ Название, 📄 Транскрипт (отправляется `.txt` файлом), 🌍 Теги, 👤 Участники, 🗑 Удалить

### Встречи — Read.ai
- Вебхук `read-ai-webhook`: как только встреча завершается → сохраняется в `entries` с `confirmed: false`
- Telegram-уведомление с кнопками: ✅ Подтвердить / ✏️ Название / 📅 Дата / 🗑 Удалить
- OAuth2 токен обновляется по крону (`readai_token_refresh`), при отсутствии встреч >72ч — алерт админу

### Встречи — Granola
- Каждый пользователь подключает **свой** аккаунт: `/connect granola <API-ключ>`
- Поллинг раз в час: cron бьёт в `swarm-bot` с `{"granola_poll": true}` → `ingestNewGranolaNotesAllUsers` импортирует новые заметки всех пользователей в `entries` и шлёт Telegram-уведомление → `gc_` / `gcp_` / `gd_`. (Standalone-функция `granola-poller` устарела и выведена из крона — она только слала уведомление, не сохраняя в БД.)
- `/granola` — ручной импорт: выбор периода → список заметок → `[🔍 Тезисы] [🗑 Пропустить]`
- Тезисы генерируются при просмотре и кэшируются в сессии; при сохранении повторный вызов API не нужен
- Сохранение через `/meetings`, `/granola` не фигурирует в командном меню (только в /help)

### Задачи
- `/tasks` — активные задачи; `/tasks [имя]` / `/tasks [страна]` — фильтры
- `/addtask` — пошаговое создание: название → описание → исполнитель → страна → дедлайн
- Статусы: `open → in_progress → done / cancelled`, просроченные помечаются
- Задачи автоматически создаются из встреч Read.ai (из action_items транскрипта)
- Смарт-поиск: если вопрос содержит TASK_KEYWORDS — сначала ищет в задачах

### Роли пользователей и назначение задач

Профили имеют роли: `marketing`, `bd` (бизнес + операционка), `rnd` (продукт).
При извлечении задач из транскрипта GPT определяет исполнителя по каскаду:
имя/email/псевдоним → роль+страна → только страна → общий пул.
Несколько исполнителей в стране — задача назначается всем. Редактируется через админку профилей.

### MCP-сервер (Claude Desktop)
Подключение: Settings → Developer → Add MCP Server → URL из `/help`

| Инструмент | Описание |
|---|---|
| `search_knowledge` | Семантический поиск (vector + keyword + file) |
| `add_knowledge` | Добавить запись; `is_private` + `owner_telegram_id` для личного |
| `get_entry` | Полный текст записи по ID |
| `list_entries` | Список с фильтрами: source, entry_type, date, has_file, requesting_user_id |
| `delete_entry` | Удалить запись + файл из Storage |
| `update_entry` | Обновить content/summary/title/date/file |
| `upload_file` | Загрузить файл в Storage (base64, до ~4MB) |
| `get_storage_stats` | Статистика базы |
| `get_tasks` | Задачи с фильтрами: assignee, country, status, period |
| `add_task` / `update_task` / `delete_task` | CRUD задач |
| `get_meetings` | Последние встречи из Read.ai |
| `get_users` | Команда с профилями, фильтр по market |

### Веб-интерфейс — Mini App «Рой»

Весь функционал бота доступен и в графическом UI — как **Telegram Mini App**, и как **обычный сайт** (PWA). Кодовое имя — «Рой».

- **Стек:** Next.js 16 + React 19 + Tailwind + shadcn; статический экспорт, хостинг — Cloudflare Pages (`swarm-brain.pages.dev`)
- **Бэкенд:** edge-функция `swarm-api` — REST поверх той же бизнес-логики, что и бот (новой логики нет, только маршруты)
- **Два режима входа:** в Telegram — по `initData` (подпись бота); в браузере — Telegram Login Widget → JWT в httpOnly-cookie
- **Экраны:** поиск + AI-ответ (RAG со сносками на источники), доска задач (на десктопе — виды Доска / Таймлайн / Спринт / Граф), база знаний, встречи + вычитка тезисов и публикация. Адаптив: мобайл — нижний таб-бар, десктоп — бенто-дашборд
- **Приватность («Рой»):** приватные задачи и записи видны только владельцу — командный бот их не показывает
- Детали — `docs/ARCHITECTURE.md` (swarm-api + miniapp), `docs/MINIAPP_EXPANSION.md`

### Рекордер встреч — SwarmRecorder (macOS)

Лёгкое **меню-бар приложение** для macOS: записывает звук онлайн-звонка и отправляет аудио в Swarm Brain, где сервер транскрибирует его и делает тезисы. Зачем — Read.ai и Granola подключаются не к каждому сервису и не к каждому звонку; рекордер пишет **любой** онлайн-звонок локально, без внешних интеграций и без локальной AI-модели.

- **Две дорожки звука:** системный звук собеседников (ScreenCaptureKit) + микрофон (AVAudioRecorder) → сервер транскрибирует каждую (Whisper) и сводит по таймстампам с метками «я» / «собеседник»
- **Клиент «тупой»:** никакой LLM на машине — транскрибация и тезисы целиком на сервере (`meeting-claim` → `meeting-ingest`)
- **Без календаря:** дедуп встречи — по комнате из ссылки звонка (Meet / Контур.Толк); авто-детект звонка — по занятости микрофона **с явным согласием** (молча не пишет)
- **Распространение:** без платного Apple-аккаунта (`recorder/install.sh`); токен вставляется через меню приложения
- Подробности и сборка — **[recorder/README.md](recorder/README.md)**

---

## Деплой

```bash
# Edge Functions — всегда с --no-verify-jwt, иначе Telegram/клиент получает 401
supabase functions deploy swarm-bot --no-verify-jwt
supabase functions deploy swarm-mcp --no-verify-jwt
supabase functions deploy swarm-api --no-verify-jwt          # бэкенд веб/Mini App
supabase functions deploy meeting-claim --no-verify-jwt       # рекордер
supabase functions deploy meeting-ingest --no-verify-jwt      # рекордер
supabase functions deploy read-ai-webhook --no-verify-jwt
# granola-poller — LEGACY, выведен из крона; деплоить не нужно. Поллинг Granola идёт через swarm-bot ({"granola_poll":true}, см. Шаг 12 в docs/SETUP.md)

# Веб/Mini App — статический экспорт → Cloudflare Pages
cd miniapp && npm run build                                   # → miniapp/out/

# Рекордер — сборка .app без платного Apple-аккаунта
cd recorder && ./install.sh                                   # подробности в recorder/README.md
```

В копи-паст примерах (URL вида `https://<YOUR_PROJECT_REF>.supabase.co/...`) подставляй свой project-ref. Прод-реф Dodo Brands — `vbqglndbxkpmreccpqmr`.

Рабочая ветка: **`sandbox_vas`**. В `main` не коммитить.

---

## Ключевые паттерны в коде

**Сессии** (`storage.ts: setSession / getSession / clearSession`) — хранят состояние диалога в `app_settings`. Формат ключа: `session_{chatId}`. Поле `action` — текущий шаг (`waiting_add`, `granola_preview_{noteId}`, `meeting_rename_{id}` и т.п.), `context` — JSON с данными шага.

**Visibility filter** (`storage.ts: visibilityFilter(userId)`) — строка для `.or()` Supabase: возвращает публичные записи + приватные только владельца.

**Chunking** (`add_knowledge` в swarm-mcp) — тексты >3000 символов бьются на чанки с overlap 200 символов; связаны через `group_id`. Первый чанк хранит `summary` и `embedding`; остальные — только `content`.

**bgRun** (`index.ts`) — обёртка для async-обработчиков: сразу возвращает 200 Telegram, продолжает работу через `EdgeRuntime.waitUntil`.

---

## Настройка Claude Desktop

См. [SETUP_CLAUDE_DESKTOP.md](./SETUP_CLAUDE_DESKTOP.md)
