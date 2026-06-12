# Backlog

## Модуль задач (Рой) — расширение miniapp в веб-продукт

> План: внешний документ «Рой — План реализации модуля задач» (передан 2026-06-09).
> Цель: таймлайн (Gantt), дерево зависимостей задач, спринты, личные задачи, Telegram-auth для браузера, PWA.

### Расхождения плана с реальной схемой (учтены при реализации)
- 🔴 `sprints.group_id` — план говорил `uuid`, реально `workspaces.id` = **text** → сделано `text`.
- `owner_telegram_id` → используем **`owner_id`** (как у `entries`, чтобы переиспользовать паттерн видимости).
- Роли `superadmin` нет — суперадмин = `allowed_users.is_admin` / `ADMIN_USER_ID`. Guard'ы мапить на `is_admin`.
- Новым таблицам нужен `GRANT ... TO service_role` (правило `_template_new_table.sql`).

### Открытый вопрос
- **Проекты-списки** (как в Reminders, для личных задач) в плане отсутствуют. Обсуждали ранее как ядро «личных задач». Решить: нужны ли отдельно от `tags`/`sprints` — отложено.

### Шаги
- **R-1** ✅ Миграции БД: privacy, timeline, sprints, dependencies (prod 2026-06-09).
- **R-2** ✅ `_shared/tasks/types.ts` — поля Роя + `Sprint`/`TaskDependency`/`DependencyType`.
- **R-3** ✅ `_shared/tasks/db.ts` — visibility приватности + фильтры; защита: личные не текут в командный бот.
- **R-4** ✅ `swarm-api` — спринты CRUD, зависимости + цикл-детекция, валидация дат, теги, owner-guard. Задеплоено.
- **R-5** 🟡 Auth Telegram Widget для браузера (B+) — **код готов, нужна настройка CF, см. ниже**.
- **R-6** ✅ miniapp: контракт `types.ts` + `api.ts` (поля задач, sprints, dependencies, tags, фильтры).
- **R-7** ✅ miniapp: `TimelineView` — editorial Gantt, drag/resize на pointer events (без `@dnd-kit`).
- **R-8** ✅ miniapp: `SprintBoard` — Kanban с нативным HTML5 DnD, спринты, прогресс.
- **R-9** ✅ miniapp: `DependencyGraph` — SVG слоистый граф (без React Flow).
- **R-10** ✅ PWA: manifest + SW (кэширует только статику) + SVG-иконка. SW написан вручную (не `@serwist`).

### 🟡 R-5 — выбран вариант B+ (httpOnly cookie + same-origin прокси). Код готов.
`output:"export"` не поддерживает Next API routes/middleware → реализовано через **Cloudflare Pages Functions**:
- `miniapp/functions/api/auth/telegram.ts` — проверка подписи Login Widget → JWT в httpOnly cookie.
- `miniapp/functions/api/[[path]].ts` — прокси `/api/*` → swarm-api; cookie→`Bearer` server-side (httpOnly недоступен JS и не уходит cross-origin — отсюда прокси).
- `swarm-api` принимает `Bearer <JWT>` (HS256, `WEB_JWT_SECRET`) вдобавок к `tma <initData>`.
- `miniapp/functions/api/auth/logout.ts` — гасит cookie. Подключён к UI: `AccountSection` в Настройках (кнопка «Выйти / сменить аккаунт», только в браузерной сессии) → `POST /api/auth/logout` → `/login`. Смена Telegram-аккаунта — через Log out в самом Login Widget.
- Bot: **@swarm_brain_bot**.

**Осталось активировать (действия пользователя):**
1. `/setdomain` в @BotFather → @swarm_brain_bot → домен miniapp (`*.pages.dev`).
2. Cloudflare Pages → env vars: `WEB_JWT_SECRET` (= тот, что в Supabase), `TELEGRAM_BOT_TOKEN`, `SWARM_API_URL=https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-api`, build-time `NEXT_PUBLIC_BOT_USERNAME=swarm_brain_bot`, `NEXT_PUBLIC_API_URL=/api`.
3. `WEB_JWT_SECRET` в Supabase — ✅ установлен.
> Тест в реале: открыть miniapp в обычном браузере → /login → войти через Telegram → доступ.

### Техдолг модуля
- **DependencyGraph N+1:** граф собирает рёбра вызовом `fetchDependencies` на каждую задачу. Нужен bulk-эндпоинт `GET /dependencies?group` для одного запроса.
- **PWA-иконки:** сейчас только SVG. Для лучшей совместимости (старый Safari/iOS) добавить PNG 192/512 + maskable.
- **Проекты-списки** (как в Reminders) — отложены (см. «Открытый вопрос»).

---

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

## MCP — доступ из Claude через орг-коннектор (Team, OAuth)

> Контекст собран 2026-06-11. Команда переходит на **корпоративные Claude-аккаунты, тариф Team.**
> Цель: подключить `swarm-mcp` к Claude так, чтобы доступ был только у нужных людей.

### Почему нельзя как сейчас
- На Team/Enterprise **кастомный коннектор добавляет только Owner орга** — рядовой участник не может подключить MCP-сервер сам.
- **Орг-коннектор = только OAuth.** В UI нет поля для статического `Authorization: Bearer`-токена (Anthropic закрыла запрос как «not planned», issue anthropics/claude-ai-mcp #112). Claude ходит на сервер из облака Anthropic; при `401` ждёт OAuth-discovery (`/.well-known/oauth-*`).
- **Нет пер-юзерного гейта** у орг-коннектора: Owner включил → подключиться может любой член орга. Ограничить доступ на стороне Claude нельзя.
- Наш статический `smcp_`-токен работает только через локальный путь — Claude Desktop `claude_desktop_config.json` + `mcp-remote --header`. Но локальный MCP корп-IT может вырубить политикой (`isLocalDevMcpEnabled=false` через MDM) → как командное решение ненадёжен.

### Вывод
Единственный санкционированный путь на Team — **Owner добавляет swarm-mcp в орг-список**, а это требует **OAuth на нашем сервере**. Гейт «нежелательных» обязан жить **внутри swarm-mcp, в шаге `authorize`**: пропускаем только тех, чья личность есть в `allowed_users`, остальным членам орга — отказ.

### Предлагаемая архитектура (переиспользуем R-5)
В R-5 уже сделан веб-вход через **Telegram Login Widget → JWT с `telegram_id`** (CF Pages Functions, httpOnly cookie). Это готовый identity-слой для OAuth-флоу:
```
Claude (орг-коннектор) → authorize на swarm-mcp
  → редирект на R-5 Telegram-login страницу (уже есть)
  → знаем telegram_id → проверяем allowed_users → нет → отказ
  → минтим MCP access-token, привязанный к telegram_id
swarm-mcp валидирует OAuth-токен (вместо/поверх текущего smcp_)
```
`allowed_users` (ключ `telegram_id`) ложится идеально, маппинг email↔telegram не нужен.

### Объём работ (для будущей дизайн-сессии)
- `swarm-mcp`: эндпоинты `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server`, `authorize`, `token`, PKCE.
- `authorize`: гейт по `allowed_users`; источник личности — R-5 Telegram-login.
- Хранение OAuth-кодов/токенов (новая таблица или переиспользовать `oauth_tokens`).
- Owner орга добавляет коннектор: Organization settings → Connectors → Add → Custom → Web.

### Что уже сделано (groundwork, prod 2026-06-11)
- ✅ Token lifecycle: миграция `mcp_token_lifecycle` — `claude_mcp_token_expires_at` (срок 90 дней), `revoke_mcp_token()`; enforce expiry в `swarm-mcp`; `/mytoken` со сроком + `/revoketoken` в боте. Это усиливает локальный (config.json) путь и пригодится как fallback.

### Открытый вопрос (узнать у Claude-админа/IT, ~неделя 2026-06-15)
- Заблокирован ли локальный MCP политикой (`isLocalDevMcpEnabled`)? Если **нет** — есть быстрый интерим для отдельных людей (config.json + `/mytoken` + strict-режим), пока строится OAuth.
- ⚠️ **Strict-режим (`MCP_AUTH_REQUIRED=true`) пока НЕ включён** — включение сломает текущие UI-коннекторы (soft-режим). Включать только после миграции на OAuth либо на config.json-путь.

---

## Общая база между воркспейсами (cross-workspace shared entries)

> Контекст собран 2026-06-12 (brainstorm-сессия, припарковано до появления необходимости).
> Идея: часть записей — заметки-инструкции вида «добавь в базу: инструкция по ТВ бордам *ссылка*» — должна быть видна **во всех воркспейсах**, а не только в своём.

### Решения, принятые в обсуждении
- **Триггер лингвистический:** «добавь в **общую** базу» = на все воркспейсы; «добавь в базу» (дефолт) = свой воркспейс. Тот же паттерн, что у `save_private` («личное», «только для меня»), только в другую сторону. Итоговая шкала видимости: **личное → воркспейс (дефолт) → общая**.
- **Модель данных:** `ADD COLUMN entries.is_shared boolean DEFAULT false` (имя уточнить — возможно `is_global`, см. конфликт нейминга ниже). `group_id` остаётся «родным» воркспейсом записи. Миграция данных не нужна — существующие записи не трогаются.
- **Ретроактивный шеринг тривиален:** любую старую запись можно сделать общей одним `UPDATE ... SET is_shared = true` по id (или кнопкой «опубликовать» постфактум). Что нельзя автоматизировать — *решить*, какие старые записи общие: ручная разметка либо разовый LLM-проход по заметкам/ссылкам с подтверждением.

### Открытый вопрос (обсуждение прервано здесь)
- **Права на общую запись для чужого воркспейса.** Склонялись к **read-only** (мутации — только владелец + суперадмин, как текущий `requireOwner`), но окончательно не утвердили. Альтернативы: вики-режим (править могут все, удалять — владелец) / полный доступ.

### Точки интеграции (разведаны)
- **Фильтры видимости** — три места, где `.eq("group_id", groupId)` меняется на `.or(group_id.eq.X, is_shared.eq.true)`:
  - `swarm-api/entries-guard.ts` — `getEntrySecure` (layer 1) + `buildEntriesQuery`;
  - `_shared/search.ts` — `matchEntries` (фильтр поверх RPC `match_entries`);
  - листинги в swarm-bot (`lib/storage.ts`).
- **Regex fast-path** `swarm-bot/index.ts` (~198): «добавь в общую базу» сейчас **НЕ** матчится (`в\s+базу` ломается словом между «в» и «базу») и уйдёт в GPT как вопрос — нужен отдельный паттерн до общего.
- **GPT-тулзы** `swarm-bot/handlers/knowledge.ts`: ⚠️ конфликт нейминга — существующий тул `save_shared` означает «общий **внутри** воркспейса». Новое понятие развести как `global`/`is_global` либо переименовать scope-параметром (`scope: workspace | global | private`).
- **MCP `add_knowledge`** — опциональный параметр + строчка в инструкцию Claude Desktop («добавь в общую базу» → ставить флаг).
- **MCP `update_entry`** — тоже принимает флаг: обязательный сценарий — **точечный перевод существующих записей в глобал по запросу через Claude** («сделай запись про ТВ борды общей» → `search_knowledge` находит id → `update_entry` ставит флаг). Права: владелец/суперадмин.

---

## Технический долг

### Безопасность
- ~~**Защита cron-эндпоинтов**~~ ✅ `X-Cron-Secret` header добавлен в swarm-bot и granola-poller (2026-06-02)
- ~~**`delete_entry` в MCP без проверки владельца**~~ ✅ ownership check добавлен, `requesting_user_id` обязателен (2026-06-02)
- **`requesting_user_id` в MCP на доверии** — нет JWT-верификации вызывающего. Решается OAuth-надстройкой (см. секцию «MCP — доступ из Claude через орг-коннектор»).

### Надёжность
- ~~**Retry на OpenAI**~~ ✅ экспоненциальный retry 3 попытки в `chatComplete` и `getEmbedding` (2026-06-02)
- ~~**Экспирация сессий**~~ ✅ TTL 30 мин через `updated_at` в sessions (2026-06-02)

### Инфраструктура
- **Staging-окружение** — завести второй Supabase-проект + тестовый Telegram-бот. Схема: feature-branch → staging → main (prod)
- ~~**Начальная схема в миграциях**~~ ✅ 2026-06-09 — `supabase/schema/00_base_schema.sql` (13 таблиц + индексы + FK + match_entries + дефолтные воркспейсы + storage-бакет). Bootstrap: `psql -f supabase/schema/00_base_schema.sql`

### Данные
- **Granola API-ключи plaintext** — хранятся в `user_integrations.api_key` без шифрования. Рассмотреть Supabase Vault или шифрование на уровне приложения
- **Файлы Storage по публичным URL** — `swarm_drive` bucket без авторизации и без срока действия ссылок. Рассмотреть signed URLs для чувствительных файлов
