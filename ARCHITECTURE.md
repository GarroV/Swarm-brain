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
| `granola-poller` | Cron (каждый час) | Опрашивает Granola API для всех пользователей, шлёт уведомления в Telegram |
| `read-ai-webhook` | Webhook от Read.ai | Принимает завершённые встречи, сохраняет в `entries`, уведомляет бота |
| `read-ai-auth` | HTTP redirect (OAuth) | OAuth callback для авторизации Read.ai, сохраняет токен в `app_settings` |
| `swarm-mcp` | MCP (Claude Desktop) | MCP-сервер для Claude Desktop: поиск, добавление знаний, управление задачами |

**Деплой:** `supabase functions deploy <name> --no-verify-jwt` (обязательно `--no-verify-jwt` для Telegram webhook)

---

## swarm-bot — структура файлов

```
supabase/functions/swarm-bot/
├── index.ts                 # Entry point: роутинг команд, callback-ов, сессий
├── handlers/
│   ├── granola.ts           # Granola: импорт/превью/сохранение встреч
│   ├── meetings.ts          # Read.ai + saved meetings: просмотр, подтверждение, редактирование
│   ├── knowledge.ts         # /add, /ask — добавление и поиск по базе знаний
│   ├── media.ts             # Голос, документы, фото, URL — парсинг и сохранение
│   ├── digest.ts            # /digest — персональный дайджест за период
│   ├── users.ts             # /users — управление командой (allow/block)
│   ├── workspace.ts         # /workspace — управление воркспейсами (суперадмин, CLI)
│   ├── superadmin.ts        # /superadmin — интерактивная inline-панель (ADMIN_USER_ID only)
│   └── help.ts              # /help — текст справки
├── tasks/
│   ├── index.ts             # Экспорт task-хендлеров
│   ├── handlers.ts          # Callback/session обработка для задач
│   ├── db.ts                # CRUD задач в Supabase
│   ├── formatter.ts         # Форматирование задач для Telegram
│   ├── matcher.ts           # NLP-определение intent, fuzzy assignee matching (findUserByMention)
│   └── types.ts             # TypeScript типы задач
└── lib/
    ├── supabase.ts          # Supabase client + ADMIN_USER_ID
    ├── openai.ts            # chatComplete(), getEmbedding()
    ├── telegram.ts          # sendMessage(), sendInlineMessage(), editInlineMessage(), answerCallback()
    ├── storage.ts           # getSession/setSession/clearSession, saveEntry, checkAllowed, visibilityFilter
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
| `workspaces` | Воркспейсы (тенанты) | `id` (TEXT PK), `name` TEXT, `created_at` |
| `entries` | База знаний — все записи | `id`, `content`, `summary`, `embedding`, `source`, `added_by`, `metadata` (jsonb), `countries`, `entry_type`, `entry_date`, `is_private`, `owner_id`, `group_id` (FK → `workspaces.id`) |
| `tasks` | Задачи команды | `id`, `title`, `assignees`, `due_date`, `status`, `meeting_id`, `created_by`, `group_id` (FK → `workspaces.id`) |
| `task_history` | История изменений задач | `task_id`, `changed_at`, `changes` |
| `sessions` | Состояние диалога бота | `chat_id` (PK), `action`, `context` (jsonb) |
| `allowed_users` | Белый список | `telegram_id`, `username`, `is_admin`, `group_id` (FK → `workspaces.id`) |
| `user_profiles` | Профили пользователей | `telegram_id`, `first_name`, `last_name`, `username` |
| `user_integrations` | API-ключи интеграций | `telegram_id`, `service` (`granola`), `api_key`, `last_polled_at`, `skipped_note_ids` |
| `app_settings` | Глобальные настройки | `key`, `value` — хранит `feedback_channel_id` |
| `oauth_tokens` | OAuth токены интеграций | `service` (`read_ai`), `client_id`, `access_token`, `refresh_token`, `expires_at`, `updated_at` |
| `oauth_state` | Временный PKCE state для OAuth | `state`, `client_id`, `code_verifier` — создаётся при старте OAuth, удаляется после callback |
| `task_comments` | Комментарии к задачам | Таблица существует, код не использует — не задействована |

**Миграции:** `supabase/migrations/` — файлы по дате. Начальная схема (`CREATE TABLE entries` и др.) **отсутствует** в миграциях (исторический долг).

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

### Granola (автоматический поллер)
```
granola-poller (hourly cron) → новые заметки за период
  → Telegram: кнопки [🔍 Тезисы / 🗑 Пропустить]  ← callback обрабатывает swarm-bot
  → дальше тот же флоу что ручной (gp_, gedit_, gc_, gcp_, gd_)
```

### Read.ai (автоматически)
```
Read.ai webhook → read-ai-webhook функция → сохраняет в entries (confirmed=false)
  → Telegram уведомление: [✅ Подтвердить / ✏️ Редактировать / 🗑 Удалить]
  → /meetings показывает все unconfirmed → mr_ → детальный просмотр
```

### Тезисы — AI-редактирование (✏️ Тезисы / ✏️ Переписать)
- **До сохранения (preview):** `gedit_` → сессия `granola_edit_preview_<noteId>` → инструкция → GPT переписывает → сессия восстанавливается в `granola_preview_<noteId>` → можно итерировать
- **После сохранения (/meetings):** `medit_` → сессия `meeting_edit_summary_<entryId>` → инструкция → GPT переписывает, читая `entries.content` + `entries.summary`

---

## Сессионный механизм

Хранится в таблице `sessions` (`chat_id` → `{action, context}`). Один активный сеанс на chat_id.

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
| `tk_mine` | Мои задачи (edit-in-place список) |
| `tk_all` | Все задачи команды |
| `tk_add` | Создать задачу (запускает addtask сессию) |
| `tk_t_<taskId>` | Детали задачи |
| `tk_st_<taskId>_<status>` | Сменить статус задачи |
| `tk_del_<taskId>` | Запрос подтверждения удаления |
| `tk_delc_<taskId>` | Подтвердить удаление задачи |

### Feedback
| Код | Действие |
|----|---------|
| `fb_done` | Пропустить скриншот, сохранить фидбек без фото |

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

## Переменные окружения

| Переменная | Где используется |
|-----------|----------------|
| `TELEGRAM_BOT_TOKEN` | swarm-bot, granola-poller |
| `SUPABASE_URL` | все функции |
| `SUPABASE_SERVICE_ROLE_KEY` | все функции |
| `OPENAI_API_KEY` | swarm-bot, swarm-mcp |

---

## Деплой и разработка

- Ветка: `sandbox_vas` → всегда разрабатывать здесь, в `main` не коммитить
- Деплой: `supabase functions deploy swarm-bot --no-verify-jwt`
- Деплой обоих: `supabase functions deploy swarm-bot granola-poller --no-verify-jwt`
- После каждого изменения функционала: обновить этот файл + `CHANGELOG.md`
