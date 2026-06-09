# Backlog

## Time + Buildin интеграция

> Дизайн: `docs/superpowers/specs/2026-06-02-time-buildin-integration-design.md`

### ⚠️ Открытый архитектурный вопрос — нужно решить перед реализацией

IT-команда разрабатывает **AI Hub** (`https://github.com/sagos95/ai-hub`) — набор интеграций с Mattermost (Time), Buildin, Kaiten и др. Они рекомендуют подключить его как **git subtree** в наш репо, чтобы получать обновления.

**Проблема:** AI Hub — это bash-скрипты для локального запуска (Claude Code, Copilot). Они не работают внутри Deno Edge Functions (swarm-bot, swarm-api).

**Нужно обсудить с IT-командой:**
1. **Сценарий использования Time**: `/time` в Telegram-боте (сервер-side Deno) — или только через Claude Desktop/Code локально?
2. **git subtree**: да, добавить AI Hub в репо — но это даёт нам только локальные Claude-скиллы, не решает серверную часть
3. **bot token**: можно ли получить `TIME_BOT_TOKEN` от их Mattermost-бота для прямых API-вызовов из наших Edge Functions?

**Три варианта архитектуры:**
- **A)** `/time` в Telegram → Deno клиент к Mattermost API напрямую (свой F-1/F-2, AI Hub как справочник)
- **B)** Только Claude Desktop/Code workflow → добавляем git subtree AI Hub, бот не трогаем
- **C)** Оба: subtree для Claude-воркфлоу + свой Deno-клиент для бота

**Статус: ждём решения от Василия после разговора с IT-командой.**

---

### Фундамент (после принятия архитектурного решения)
- **F-1** `_shared/time/client.ts` — Mattermost HTTP-клиент (авторизация, чтение постов за период)
- **F-2** `_shared/time/summary.ts` — GPT-саммари сообщений (участники, темы, решения)
- **F-3** `_shared/buildin/client.ts` + `types.ts` — Buildin HTTP-клиент (read/write страниц, доски)
- **F-4** Суперадмин-команды: `/sa time_token`, `/sa time_channels`, `/sa buildin_token`, `/sa buildin_space_id`

### Time — бот
- **T-1** `/time` — пикер канала → пикер периода → саммари → [Сохранить / Закрыть]. Callback: `tm_`, session: `time_*`
- **T-2** `/time digest` — дайджест всех каналов за период → отправляет запросившему → [Сохранить / Закрыть]
- **T-3** `swarm-api`: `GET /time/channels`, `POST /time/summary`, `POST /time/digest` (для Mini App)

### Buildin — бот + MCP
- **B-1** `/buildin import` — дерево страниц → выбор → превью → saveEntry (source="buildin")
- **B-2** `/buildin publish` — выбор записи из базы → пикер Buildin → createPage/updatePage
- **B-3** `/buildin board` — список досок → снэпшот → saveEntry (source="buildin_board")
- **B-4** MCP-инструменты: `buildin_read_page`, `buildin_write_page`, `buildin_search`, `buildin_get_board`
- **B-5** `swarm-api`: `GET/POST /buildin/pages`, `GET /buildin/boards` (для Mini App). Callback: `bd_`, session: `buildin_*`

### Позже
- **Z-1** Scheduled дайджест Time с broadcast в настроенный чат воркспейса
- **Z-2** Mini App: экран Time (каналы, саммари, дайджест)
- **Z-3** Mini App: экран Buildin (страницы, import/publish, доски)
- **Z-4** Holst интеграция: экспорт доски → Swarm entry (решить нужно ли)

**Порядок:** F-1 → F-2 → T-1 → T-2 → F-3 → B-1 → B-2 → B-4 → остальное по потребности

---

## Фичи

### Mini App — баги и фичи по итогам ревью 2026-06-02

~~#### BUG-1: Профиль — role и markets не подтягиваются~~ ✅ уже было исправлено
`GET /me` возвращает `role`, `markets`, `username`. `ProfileSection` инициализируется из `me`. Аудит 2026-06-04.

---

~~#### BUG-2: Команда — профили не заполнены~~ ✅ 2026-06-04
`autoSyncProfile` вызывается на каждое сообщение/callback — backend корректен. Backend всегда возвращает fallback `name = String(telegram_id)`. Frontend `TeamScreen.tsx` исправлен: числовое имя отображается как `#12345678`.

---

#### ~~FEAT-3: Рынки — жёсткий список вместо текстового поля~~ ✅ 2026-06-03
Реализовано: toggle-chips по группам (Европа / Другие рынки), список хардкодом в `SettingsScreen.tsx`.
Нормализация легаси-значений при загрузке (English→Russian, скобки убраны).

---

#### ~~FEAT-4: Встречи — редактирование стран~~ ✅ 2026-06-03
Реализовано: chips + поле добавления в `MeetingDetailDialog`, `PATCH /meetings/:id` принимает `countries`.

---

~~#### FEAT-5: Нормализация стран по ISO-кодам + Суперадминка~~ ✅ 2026-06-04
- `_shared/countries.ts` + `miniapp/src/lib/countries.ts` — ISO registry + `normalizeCountries()`
- Все 4 GPT write-пути нормализованы: swarm-bot, read-ai-webhook, swarm-api, swarm-mcp
- SQL миграция: `workspaces.allowed_markets` + нормализация существующих данных
- `GET /config` — список разрешённых рынков воркспейса
- `PATCH /me` markets нормализует перед записью в БД
- `GET /me` возвращает `is_admin`
- `swarm-api/admin.ts` — `/admin/workspaces` CRUD (просмотр, добавление/удаление пользователей, настройка рынков)
- Mini App: `AdminScreen.tsx`, условный таб «Админ», `SettingsScreen` chips загружаются из `/config` и хранят ISO-коды

---

~~### Mini App — порядок кнопок статуса в карточке~~ ✅ уже исправлено
`STATUS_ACTIONS.in_progress`: `← Open` слева, `→ Done` справа — порядок корректный. Аудит 2026-06-04.



### Веб-интерфейс — граф знаний
Визуальный интерфейс в стиле Obsidian для всей команды. Узлы = записи, встречи, задачи, люди. Кластеры по странам (цветом). Рёбра = семантическая близость через pgvector (cosine distance, автоматически) + структурные связи (задача → встреча через `meeting_id`). Кликабельные ноды с боковой панелью.
- Стек: Next.js / SvelteKit + shadcn/ui + react-force-graph
- Бэкенд: Supabase Auth + существующие Edge Functions

---

### Дедупликация встреч Granola при нескольких участниках
Если несколько пользователей бота были на одной встрече и оба импортируют её через `/granola` — в базе появятся два дубля одной встречи. Сейчас дедупликация работает только в рамках одного пользователя (по `metadata->>granola_note_id` + `added_by_telegram_id`), но не по воркспейсу.

Варианты решения (выбрать один):
- **Проверка перед сохранением**: при `gc_` (сохранить в базу) проверять нет ли уже записи с тем же `granola_note_id` в `group_id`. Если есть — сообщить "эта встреча уже в базе, добавлена [username]" и пропустить
- **Первый выигрывает**: сохраняет тот кто первый нажал "В базу", остальным предложить пропустить автоматически
- **Слияние**: при обнаружении дубля — сравнить саммари и предложить обновить существующую запись

Нужно обсудить с командой прежде чем делать — зависит от того хотят ли люди иметь личные версии одной встречи или одну общую.

---

### Админка — управление пользователями и интеграциями
Инструмент для просмотра и управления состоянием системы без прямого SQL. Минимальный scope:
- Список пользователей (`allowed_users`): кто подключён, в каком воркспейсе, когда добавлен
- Интеграции (`user_integrations`): у кого подключена Granola, когда последний poll, есть ли ошибки
- Возможность сбросить `last_polled_at` или `skipped_note_ids` без SQL
- Добавить/удалить пользователя из `allowed_users` с выбором группы

Форм-фактор: либо Telegram-команды для суперадмина (`/admin users`, `/admin integrations`), либо простая веб-страница на swarm-api. Актуально когда пользователей станет больше 5-10.

---

## Mini App — расширение функционала

> ✅ Фазы 0–5 реализованы (аудит 2026-06-08): экраны «Команда», «База знаний» (list/view/edit/delete/search), «Встречи» (list/view/confirm/edit стран/delete), Granola-импорт (статус/список/превью/импорт/скип), дайджест, фидбек, загрузка файлов, AI-парсинг задач — в `KnowledgeScreen`/`MeetingsScreen`/`SettingsScreen`/`AdminScreen`/`TeamScreen`. Бэкенд: `/entries`, `/entries/:id`, `/search`, `/meetings/:id`, `/granola/notes(...)`, `/digest`, `/feedback`, `/entries/upload`, `/tasks/extract`, `/integrations*`.

### Открыто: Голос — запись через Web Audio API

В боте голос идёт через Telegram `fileId` → Whisper. В Mini App доступа к `fileId` нет — нужен `MediaRecorder` (запись в браузере) → blob → `POST /entries/upload` (эндпоинт уже принимает файлы, надо проверить `audio/webm`).
- Что меняется: только **frontend** — кнопка «Записать голос» + `MediaRecorder`
- 🟡 Средне — браузерный API, тестировать поведение в Telegram WebView

### Не реализовывать в Mini App
`/broadcast` (нет доступа к Bot API), `/superadmin`/`/workspace`/`/mytoken`/`/connect_claude`/`/claude` (только для ADMIN_USER_ID или токены Claude Desktop), Read.ai интеграция (OAuth только через Telegram, нет per-user flow — отложено до появления per-user OAuth).

---

## Ревью системы задач — приоритет

~~### Задачи: ревью изоляции и видимости~~ ✅ 2026-06-04 — аудит завершён

**Вывод аудита (2026-06-04):**
- `GET /tasks` в swarm-api: всегда фильтрует по `groupId` из JWT — изоляция есть ✅
- `get_tasks` в swarm-mcp: `requesting_user_id` обязателен, `groupId` разрешается через `allowed_users` и применяется — изоляция есть ✅
- Mini App: `fetchTasks()` вызывает `GET /tasks` с JWT авторизацией — изоляция есть ✅
- Семантика задач: **командные** (видны всем в воркспейсе) — это intended behavior
- "Задачи которые я не помню" — скорее всего задачи созданные через AI-парсинг встреч (`confirmed=false`), видны в разделе «На проверке». Не утечка, а ожидаемое поведение воркспейса.
- Единственный edge case: `add_task` в MCP без `requesting_user_id` создаёт задачи с `group_id=null` — они невидимы ни для кого. Не критично, но стоит сделать `requesting_user_id` обязательным в будущем.

---

## Технический долг

### Безопасность
- ~~**Защита cron-эндпоинтов**~~ ✅ `X-Cron-Secret` header добавлен в swarm-bot и granola-poller (2026-06-02)
- ~~**`delete_entry` в MCP без проверки владельца**~~ ✅ ownership check добавлен, `requesting_user_id` обязателен (2026-06-02)
- **`requesting_user_id` в MCP на доверии** — нет JWT-верификации вызывающего. Долгосрочно: привязать к Supabase Auth

### Надёжность
- ~~**Retry на OpenAI**~~ ✅ экспоненциальный retry 3 попытки в `chatComplete` и `getEmbedding` (2026-06-02)
- ~~**Экспирация сессий**~~ ✅ TTL 30 мин через `updated_at` в sessions (2026-06-02)

### Инфраструктура
- **Staging-окружение** — завести второй Supabase-проект + тестовый Telegram-бот. Схема: feature-branch → staging → main (prod)
- ~~**Начальная схема в миграциях**~~ ✅ 2026-06-09 — `supabase/schema/00_base_schema.sql` (13 таблиц + индексы + FK + match_entries + дефолтные воркспейсы + storage-бакет). Bootstrap: `psql -f supabase/schema/00_base_schema.sql`

### Данные
- **Granola API-ключи plaintext** — хранятся в `user_integrations.api_key` без шифрования. Рассмотреть Supabase Vault или шифрование на уровне приложения
- **Файлы Storage по публичным URL** — `swarm_drive` bucket без авторизации и без срока действия ссылок. Рассмотреть signed URLs для чувствительных файлов
