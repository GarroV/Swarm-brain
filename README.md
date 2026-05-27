# Swarm Brain

Командная база знаний с AI-поиском и интеграцией митингов. Работает в Telegram и Claude Desktop, живёт на Supabase Edge Functions.

---

## Цель проекта

Собрать в одном месте всё, что знает команда — заметки, документы, договорённости, итоги встреч, ссылки — и сделать эту информацию мгновенно доступной через естественный язык. Бот работает там, где команда уже общается (Telegram), не требует переключения контекста.

---

## Технический стек

| Слой | Технология |
|------|-----------|
| Runtime | Deno (Supabase Edge Functions) |
| База данных | Supabase (PostgreSQL + pgvector) |
| Хранилище файлов | Supabase Storage (bucket: `swarm_drive`) |
| AI | OpenAI GPT-4o-mini, Whisper, text-embedding-3-small |
| Интерфейс | Telegram Bot API |
| Митинги | Read.ai (OAuth2 + webhook), Granola (API key per user) |

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
│   ├── granola-poller/         # Hourly cron: поллинг Granola для всех пользователей
│   ├── read-ai-auth/           # OAuth2 авторизация Read.ai
│   └── read-ai-webhook/        # Вебхук: приём встреч из Read.ai → /meetings
└── migrations/
    ├── 20260519_tasks_columns.sql
    ├── 20260521_app_settings.sql
    ├── 20260522_user_integrations.sql
    └── 20260525_private_space.sql
```

---

## Таблицы БД

| Таблица | Назначение |
|---------|-----------|
| `entries` | База знаний: тексты, файлы, встречи, заметки. Поля: `content`, `summary`, `embedding` (vector), `source`, `entry_type`, `countries`, `entry_date`, `is_private`, `owner_id`, `group_id`, `metadata` |
| `tasks` | Задачи команды: `title`, `assignees[]`, `country`, `due_date`, `status`, `meeting_id` |
| `task_history` | История изменений задач |
| `allowed_users` | Белый список Telegram-аккаунтов |
| `user_profiles` | Профили: `first_name`, `last_name`, `role`, `markets[]`, `phone`, `email` |
| `user_integrations` | Интеграции пользователей: Granola API ключи, `last_polled_at`, `skipped_note_ids[]` |
| `app_settings` | Глобальные настройки (курсоры, токены) |

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
- Поллинг раз в час (`granola-poller`): новые заметки → Telegram-уведомление → `gc_` / `gcp_` / `gd_`
- `/granola` — ручной импорт: выбор периода → список заметок → `[🔍 Тезисы] [🗑 Пропустить]`
- Тезисы генерируются при просмотре и кэшируются в сессии; при сохранении повторный вызов API не нужен
- Сохранение через `/meetings`, `/granola` не фигурирует в командном меню (только в /help)

### Задачи
- `/tasks` — активные задачи; `/tasks [имя]` / `/tasks [страна]` — фильтры
- `/addtask` — пошаговое создание: название → описание → исполнитель → страна → дедлайн
- Статусы: `open → in_progress → done / cancelled`, просроченные помечаются
- Задачи автоматически создаются из встреч Read.ai (из action_items транскрипта)
- Смарт-поиск: если вопрос содержит TASK_KEYWORDS — сначала ищет в задачах

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

---

## Деплой

```bash
# Всегда с --no-verify-jwt, иначе Telegram получает 401
supabase functions deploy swarm-bot --no-verify-jwt
supabase functions deploy swarm-mcp --no-verify-jwt
supabase functions deploy granola-poller --no-verify-jwt
supabase functions deploy read-ai-webhook --no-verify-jwt
```

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
