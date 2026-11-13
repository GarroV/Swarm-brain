# Swarm Brain

**Командная база знаний, которая помнит за вас.** Итоги встреч, задачи и документы команды — в одном месте, с ответами на обычном языке. Работает там, где команда уже сидит: в Telegram, в браузере, в Claude Desktop и с собственного рекордера звонков на Mac — bumblebee.

## 🔗 Живое демо — зайти за 10 секунд, без регистрации

### **[→ Открыть демо-воркспейс](https://swarm-team.app/api/auth/demo?key=f4a2bc8e3401d76455aa3e9243cecc1583616b61d105cdfd)**

**Знания команды перестают теряться в чатах, дисках и чужих головах.** Swarm Brain держит встречи, задачи и документы в одном месте и отвечает на вопросы обычным языком — из Telegram, браузера или Claude Desktop, а bumblebee сам пишет и расшифровывает встречи. Одна база — четыре двери, что создал в одной, видно в остальных.

В демо уже наполнен рабочий день команды. Что попробовать:

- 🔎 **Спросите базу, как живого коллегу** — ответ со ссылками на источники вместо получаса листания переписки. В демо вопросы заготовлены заранее («Что решили по релизу приложения?», «Почему в час пик обслуживание медленное?» и другие): ответы собраны из демо-данных, модель ИИ в демо не вызывается. Со своими данными спрашивайте что угодно.
- ✅ **Задачи рождаются сами из встреч** — расшифровка → тезисы → готовые задачи с исполнителями и странами. Доска, спринт, граф зависимостей, срезы «мои / команда / по рынкам».
- 🎙 **Встречи записываются и расшифровываются без вас** — bumblebee на Mac или Granola → сервер делает стенограмму и тезисы, вам остаётся вычитать и опубликовать одним касанием.
- 📊 **Утренний дайджест по вашим рынкам** — что произошло за неделю, собрано автоматически, без ручной сводки.

Это изолированная витрина: тыкайте, создавайте, ломайте — рабочих данных не заденете, каждые 30 минут всё возвращается к эталону. Ссылка на демо **публичная намеренно**: ключ в ней — не секрет, а адрес входа; безопасность держится на изоляции демо-сессии (отдельное пространство, без админки, без интеграций, без вызовов платной модели), а не на тайне ссылки.

---

## Что это и зачем

**Проблема.** Знания команды расползаются: часть в чатах, часть в головах, итоги созвонов теряются, задачи не доходят до исполнителей. Через месяц никто не помнит, что решили и почему.

**Решение.** Swarm Brain собирает встречи, задачи и документы в одну базу и позволяет спрашивать её обычным языком — как коллегу, который был на всех созвонах и всё записал. Отвечает по содержимому со ссылками на источники, а не «по памяти».

**Для кого.** Распределённые команды, которые много созваниваются и работают по нескольким странам/рынкам. Каждый — в своём инструменте: маркетолог в Telegram, руководитель в вебе, аналитик в Claude Desktop. Данные каждой команды изолированы в своём **воркспейсе**.

_Текущее развёртывание — Dodo Brands (рынки CEE и Other). Детали — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)._

---

## Как это работает

Короткий сквозной пример — путь одной встречи от звонка до ответа в поиске:

1. **Созвон** идёт в Meet или Контур.Толк. **bumblebee** — приложение в меню-баре Mac — пишет две звуковые дорожки: вас и собеседников.
2. **Расшифровка.** Аудио уходит на сервер: он переводит речь в текст (Whisper) и делает **тезисы** — краткую выжимку по темам, а не дословную стенограмму.
3. **Вычитка.** Встреча попадает в **приёмную** (статус «на вычитке»). В вебе вы проверяете тезисы, страны и участников — и одним касанием публикуете в базу знаний.
4. **Задачи.** По кнопке из тезисов извлекаются задачи с исполнителями и странами — и появляются на доске (список / спринт / граф).
5. **Ответ.** Через неделю любой в команде спрашивает базу «что решили по Сербии?» — и получает ответ со ссылкой на эту самую встречу.

Granola и Read.ai — альтернативные источники встреч, ведут в ту же приёмную. Всё, что попало в базу через одну «дверь» (бот / веб / Claude Desktop), видно из остальных. Полный список сценариев и терминов — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (разделы «Сквозные сценарии» и «Глоссарий»).

---

## Поверхности

Четыре двери в одну базу — каждый входит там, где ему удобно. Все поверх одного бэкенда (Supabase Edge Functions + Postgres/pgvector + OpenAI). Подробности — **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (разделы «Поверхности продукта» и «Сквозные сценарии»).

| Поверхность | Доступ | Бэкенд-функция |
|-------------|--------|----------------|
| Telegram-бот | команды и сообщения в чате | `swarm-bot` |
| Веб-интерфейс «Рой» | браузер: Google Sign-In → JWT (вход как Telegram Mini App отключён) | `swarm-api` |
| Claude Desktop (MCP) | токен + команда установки — **только веб → Настройки → Claude Desktop** (бот ключи не выдаёт, решение 26.10.2026) | `swarm-mcp` |
| bumblebee | macOS меню-бар; установка — **только веб → Настройки → bumblebee** (бот ключи не выдаёт) | `meeting-claim`, `meeting-ingest`, `meeting-process` |
| Granola | API-ключ на пользователя (`/connect granola`), часовой поллинг → единая приёмная встреч (`meetings`) | `swarm-bot` (`granola_poll`) |
| Read.ai | OAuth2 + webhook — **отключается** (`READ_AI_ENABLED` off, не развивается) | `read-ai-auth`, `read-ai-webhook` |
| Хаб проектов (публичная дорожная карта) | без авторизации, только чтение: `GET /swarm-api/public/roadmap/:projectId` отдаёт опубликованную доску (флаг `projects.public_roadmap`) — название, статус, срок, дата выкатки задач; описаний, исполнителей и комментариев нет | `swarm-api` |

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
| Интерфейс | Telegram Bot API + веб-интерфейс (Next.js 16, React 19) |
| Веб-бэкенд | `swarm-api` (REST поверх Edge Functions), хостинг Cloudflare Pages |
| bumblebee (рекордер) | macOS, Swift + ScreenCaptureKit + AVFoundation (меню-бар приложение) |
| Митинги | Read.ai (OAuth2 + webhook), Granola (API key per user), bumblebee (свой macOS-рекордер) |

---

## Структура проекта

```
supabase/
├── functions/                  # Edge Functions (по папке на функцию), общий код — _shared/
│   ├── swarm-bot/              # Telegram-бот (основной); файлы — ARCHITECTURE «swarm-bot — структура файлов»
│   ├── swarm-mcp/              # MCP-сервер для Claude Desktop / claude.ai / ChatGPT (JSON-RPC)
│   ├── swarm-oauth/            # OAuth для MCP: регистрация клиента, PKCE, обмен и отзыв токенов
│   ├── swarm-setup/            # Скрипт установки Claude Desktop (публичный GET)
│   ├── swarm-api/              # REST API для веб-интерфейса (поверх той же логики, что и бот)
│   ├── auth-resolve/           # Веб-вход: verified e-mail Google → строка allowed_users (вызов подписан HMAC, от CF Pages)
│   ├── auth-passkey/           # Веб-вход: второй шаг — ключ доступа (WebAuthn)
│   ├── google-oauth/           # Привязка Google Календаря для рекордера
│   ├── swarm-recorder-setup/   # Установщик bumblebee (публичный GET)
│   ├── swarm-recorder-version/ # Последний build рекордера + URL для автообновления
│   ├── meeting-claim/          # Рекордер: claim/lease встречи до транскрибации
│   ├── meeting-ingest/         # Рекордер: приём аудио → Storage → durable-обработка
│   ├── meeting-process/        # Cron durable-обработки (транскрибация по кускам + тезисы)
│   ├── meeting-status/ meeting-current/ meeting-context/ meeting-heartbeat/ recorder-diag/ meeting-webtoken/
│   │                           # Рекордер: статус встреч, «что идёт сейчас», контекст прошлой встречи, heartbeat, журнал, обмен токена рекордера на веб-сессию
│   ├── meeting-invite/ meeting-calendar/ meeting-calendar-snapshot/ meeting-missed/ meeting-notice/
│   │                           # Бот встреч scriba: приглашения, автозапуск по календарю, снимок календаря, пропуски, уведомления об отказе
│   ├── market-ingest/          # Приём данных сборщиков «Анализа рынка» (GitHub Actions)
│   ├── granola-poller/         # LEGACY: standalone-поллер, выведен из крона. Поллинг Granola — внутри swarm-bot (ingestNewGranolaNotesAllUsers)
│   ├── read-ai-auth/           # OAuth2 Read.ai (выключена, READ_AI_AUTH_ENABLED off → 403)
│   ├── read-ai-webhook/        # Вебхук Read.ai (отключается, READ_AI_ENABLED off)
│   └── _shared/                # общий код: tasks/, entries/, users/, market/, sources (реестр источников), mcp-token, recorder-token, meeting-processor, meeting-dedup, search, countries и др.
└── migrations/                 # ВСЯ схема: 00000000_initial_schema.sql + инкрементальные. Старт с нуля — supabase db reset (или db push)

miniapp/                        # Веб-интерфейс «Рой» (Next.js 16 → статический экспорт → Cloudflare Pages; имя папки историческое — это обычный сайт/PWA, НЕ Telegram Mini App)
└── src/                        # Поиск/RAG, доска задач, база знаний, вычитка встреч

recorder/                       # bumblebee — macOS меню-бар рекордер встреч (Swift)
└── Sources/SwarmRecorder/      # запись звонка (2 дорожки) → meeting-claim/ingest
```

---

## Таблицы БД

В схеме `public` около 70 таблиц (72 по миграциям на 09.11.2026; список собирается из `supabase/migrations/`). Полный справочник с ключевыми полями — **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (раздел «Таблицы БД»), единственный источник истины; здесь только опорные:

| Таблица | Назначение |
|---------|-----------|
| `workspaces` | Воркспейсы (тенанты); `id` — постоянный слаг, не название |
| `entries` | База знаний — все записи (встречи и заметки); архив вместо удаления |
| `tasks` | Задачи команды (слой личных задач снят 09.10.2026) |
| `projects`, `sprints` | Доска «Проекты» и её пространства (`sprints.kind`: `board_tab` / `space`) |
| `sprint_cycles`, `sprint_items` | Спринты: период с приёмкой и замороженный снимок состава |
| `task_history`, `task_comments`, `task_files`, `task_labels` | Журнал, комментарии, файлы и личные метки задач |
| `meetings` | Swarm Meetings — источник истины о встрече рекордера/бота (НЕ путать с `entries`) |
| `allowed_users`, `user_profiles` | Белый список людей (почта, `telegram_id`, токены MCP/рекордера) и их профили |
| `user_integrations`, `oauth_tokens`, `oauth_state` | Ключи и токены интеграций (Granola, Google Календарь, Read.ai) |
| `sessions` | Состояние диалога бота (TTL 30 мин) |
| `mkt_*` | «Анализ рынка» — данные по странам |
| `mcp_oauth_*` | OAuth для MCP (ChatGPT), см. [docs/MCP_OAUTH.md](docs/MCP_OAUTH.md) |
| `app_settings` | Глобальные настройки (плашка работ, заморозка и др.) |

Таблицы `task_dependencies` (снесена 12.08.2026) и «зависимости задач» больше нет.

---

## Команды бота

Полный список команд роутера `swarm-bot` (26). Часть команд в меню Telegram (`setMyCommands`) не выводится — они доступны вводом вручную или из `/help`.

| Категория | Команды |
|-----------|---------|
| Знания | `/add` — добавить запись · `/ask` — задать вопрос · `/status` — состояние базы |
| Встречи | `/meetings` — инбокс на подтверждение · `/granola` — ручной импорт Granola · `/connect granola <ключ>` — подключить Granola · `/disconnect granola` — отключить |
| Задачи | `/tasks` — активные задачи (фильтры по имени/стране) · `/addtask` — создать задачу |
| Команда | `/users` — управление командой и профилями |
| Claude Desktop | `/setup`, `/mytoken` — не выдают ключ, а отсылают в веб → Настройки → Claude Desktop ([решение 26.10.2026](docs/decisions/2026-10-26-second-step-hard-gate.md)) · `/connect_claude` — инструкция по подключению · `/claude` — инструкции для проекта · `/revoketoken` — отозвать MCP-токен |
| bumblebee | `/recordertoken` — токен не выдаёт, отсылает в веб → Настройки → bumblebee (при живом токене даёт команду обновления приложения без токена) · `/revokerecordertoken` — отозвать токен |
| Администратор | `/superadmin` — панель супер-админа · `/workspace` — управление воркспейсами · `/broadcast` — рассылка команде · `/report` — ежедневный отчёт активности за вчера (счётчики встреч/данных) |
| Утилиты | `/start` — главное меню · `/help` — справка · `/reset` — сбросить состояние · `/feedback` — отправить фидбек · `/digest` — личный дайджест |

---

## Функциональность

### База знаний
- **Добавление** — текст, ссылки, документы (TXT, MD, CSV, JSON, XLSX, PDF), фото, голосовые
- **Семантический поиск** — векторные эмбеддинги (text-embedding-3-small) + keyword fallback
- **AI-ответы** — GPT-4o-mini с tool-calling: ищет по базе, отвечает на русском
- **Автообработка** — голос → Whisper → текст, фото → Vision → описание, URL → парсинг страницы
- **Приватные записи** — `is_private: true` + `owner_id`: видны только владельцу. Работает в Telegram и Claude Desktop

### Встречи — единый флоу (захват → вычитка → публикация)

Все источники ведут в одну приёмную `meetings` (`status=awaiting_review`) → вычитка → публикация в базу знаний (`entries`, финальный артефакт). Источник влияет только на метку. Унификация в процессе — дизайн в `docs/superpowers/specs/2026-07-02-unified-transcriber-contract-design.md`; Read.ai отключается.

- **bumblebee** — двухшаговый durable-протокол (`meeting-claim` → `meeting-ingest` → cron `meeting-process`): транскрибация по кускам (переживает лимиты воркера) + тезисы. Черновик в `meetings.draft_notes_md`.
- **Granola** — каждый подключает свой аккаунт (`/connect granola <ключ>`); поллинг раз в час (`swarm-bot`, `{"granola_poll":true}` → `ingestNewGranolaNotesAllUsers`) кладёт встречи в приёмную с готовыми тезисами. **Ручная выгрузка «не жди бота»** — `/granola` (выбор заметки → импорт в очередь вычитки сейчас). Standalone `granola-poller` — legacy, выведен из крона.
- **Вычитка и публикация** — в вебе (Встречи → «на вычитке»): проверить тезисы / название / страны / участников → опубликовать. Единый эндпоинт `POST /agent-meetings/:id/publish` (провенанс источника сохраняется).
- **Дедуп** — кросс-источниковый `findDuplicateMeeting` (одна встреча из Granola и bumblebee не двоится).
- **Read.ai** (отключается, `READ_AI_ENABLED` off): вебхук `read-ai-webhook` писал в `entries` (`confirmed:false`); legacy-встречи «на согласовании» доживают старым путём (бот-кнопки `mc_`/`met_`/`med_`/`md_`).

### Задачи
- `/tasks` — активные задачи; `/tasks [имя]` / `/tasks [страна]` — фильтры
- `/addtask` — пошаговое создание; **свободным текстом** — «добавь/создай/поставь [кому] задачу: …» (`parseCreateTaskCommand`, создаёт сразу, отделено от поиска)
- Статусы: `open → in_progress → done / cancelled`, просроченные помечаются
- **Из встречи** — по кнопке «Сгенерировать задачи» на экране вычитки (preview → добавить, привязка `meeting_id`; `POST /tasks/extract`, MCP `extract_tasks_from_meeting`). Автоизвлечение в боте (`analyzeAndCreateTasks`) удалено 05.09.2026
- Смарт-поиск: если вопрос содержит TASK_KEYWORDS — сначала ищет в задачах

### Роли пользователей и назначение задач

Профили имеют роли: `marketing`, `bd` (бизнес + операционка), `rnd` (продукт) — это пометка профиля и задачи (`tasks.task_role`), а не правило назначения.
При извлечении задач из тезисов (`_shared/task-extract.ts`) модель называет исполнителя полным именем; сервер сверяет его с людьми воркспейса (имя / псевдоним / e-mail, `matchAssignee`). Не нашли или не назвали — задача уходит на того, кто её забирает ([решение 28.08.2026](docs/decisions/2026-08-28-assignee-falls-back-to-author.md)). Каскад «роль+страна → страна → общий пул» удалён.

### MCP-сервер (Claude Desktop + claude.ai + ChatGPT)

**ChatGPT — на проде с 30.10.2026:** карточка в личных настройках, OAuth-вход через сайт и отдельный отзыв доступа. Проверен вызов MCP из облака OpenAI; создание коннектора в браузерном ChatGPT ещё не проверено. [Инструкция и устройство](docs/MCP_OAUTH.md).
Два пути подключения (инструкция в боте — `/connect_claude`): **(A) Claude Desktop на Mac** — веб → Настройки → Claude Desktop выдаёт one-liner для терминала (ставит мост и пишет `config.json`); **(B) claude.ai в браузере** — токен `smcp_…` из той же команды вставляется вручную в Settings → Connectors (URL `swarm-mcp` + Bearer). С 26.10.2026 ключи выдаёт только веб (после Touch ID); `/setup`, `/mytoken` в боте отсылают туда. Токен живёт **30 дней** (и гаснет при смене пространства или роли); `Invalid token` чаще = рассинхрон (клиент шлёт старый токен), а не срок. Перевыпуск убивает старый токен и рвёт рабочее подключение — в вебе кнопка так и подписана («Перевыпустить команду установки»). Хелперы токена — `_shared/mcp-token.ts` (бот и веб — тонкие двери).

Сейчас в `swarm-mcp` **68 инструментов**. Полная таблица с поведением каждого — единственный источник истины: [docs/ARCHITECTURE.md → swarm-mcp](docs/ARCHITECTURE.md) (раздел «Инструменты (tools) swarm-mcp»); классификация чтение / запись / удаление — `TOOL_CLASSES` в `supabase/functions/swarm-mcp/annotations.ts`. Группы:

| Группа | Инструменты |
|---|---|
| База знаний | `search_knowledge`, `add_knowledge`, `get_entry`, `list_entries`, `update_entry`, `reindex_entry`, `delete_entry`, `upload_file`, `get_storage_stats` |
| Встречи | `get_meetings` (последние встречи базы знаний любого источника), `get_today_meetings` (календарь на сегодня), `get_review_queue`, `get_draft_meeting`, `update_draft_meeting`, `publish_draft_meeting`, `extract_tasks_from_meeting` |
| Задачи | `get_tasks`, `add_task`, `update_task`, `delete_task`, `get_projects`, `get_task_stats`, `get_task_history`, `get_recent_task_changes`, `set_task_subscription` |
| Комментарии и метки | `get_task_comments`, `get_recent_comments`, `add_task_comment`, `delete_task_comment`, `list_task_labels`, `create_task_label`, `rename_task_label`, `delete_task_label` |
| Спринты | `get_sprints`, `get_sprint`, `create_sprint`, `update_sprint`, `start_sprint`, `accept_sprint`, `delete_sprint`, `get_sprint_journal`, `get_sprint_spaces`, `create_sprint_space`, `create_sprint_group`, `rename_sprint_space`, `archive_sprint_space`, `add_sprint_tasks`, `move_sprint_task`, `remove_sprint_task`, `mark_sprint_task`, `set_sprint_task_span` |
| Люди и уведомления | `whoami`, `get_users`, `get_notifications`, `mark_notifications_read`, `get_feedback`, `resolve_feedback` (последние два — только владелец) |
| Анализ рынка | `market_template`, `market_status`, `market_get`, `market_set_block`, `market_set_company_year`, `market_upsert_location`, `market_upsert_chain`, `market_set_price`, `market_add_fact` |
| Проверки Децимуса | `get_inspections`, `get_inspection` |

### Веб-интерфейс «Рой»

Весь функционал бота доступен и в графическом UI — **обычный веб-сайт (PWA)** в браузере. Кодовое имя — «Рой». _(Раньше открывался и как Telegram Mini App внутри Telegram — этот вход **отключён**, бот теперь ведёт на PWA. Папка `miniapp/` — историческое имя каталога.)_

- **Стек:** Next.js 16 + React 19 + Tailwind + shadcn; статический экспорт, хостинг — Cloudflare Pages (`swarm-team.app`)
- **Бэкенд:** edge-функция `swarm-api` — REST поверх той же бизнес-логики, что и бот (новой логики нет, только маршруты)
- **Вход:** только Google (решение 27.10.2026; Telegram Login Widget удалён) → JWT в httpOnly-cookie; второй шаг — ключ доступа (Touch ID / WebAuthn). Почта человека должна быть в `allowed_users`. Схему `tma` (вход как Telegram Mini App) `swarm-api` не принимает: любой заголовок `Authorization`, кроме `Bearer`, получает 401. Подробнее — [ARCHITECTURE → swarm-api](docs/ARCHITECTURE.md) и [решение](docs/decisions/2026-10-27-google-only-login.md).
- **Экраны:** поиск + AI-ответ (RAG со сносками), доска задач (десктоп — виды Список / Таймлайн / Спринт / Граф; линзы Мои / Команда / Все; для админа — «Все сотрудники» с группировкой по исполнителю), база знаний, встречи + вычитка и публикация. Адаптив: мобайл — таб-бар, десктоп — бенто-дашборд
- **Настройки** («Ещё»): профиль/рынки, Granola, Google-календарь, дайджест, загрузка файла, фидбек, **bumblebee** и **Claude Desktop** — установка из веба (единственное место выдачи ключей Claude и bumblebee)
- **Админка** (для админов): воркспейсы (создать/переименовать), пользователи (добавить/переместить/удалить, правка профилей), broadcast, сводка «на вычитке по участникам» — паритет с бот-суперадмином
- **Админ = суперадмин:** `isAdmin = зашитый ADMIN_USER_ID ИЛИ флаг allowed_users.is_admin` (мультиадмин). Объём админа — **его воркспейс**; личные записи и встречи других людей админ **не видит** (обхода нет, решение 07.08.2026), общие встречи может править и удалять. Правила доступа — одна таблица в [ARCHITECTURE → Контроль доступа](docs/ARCHITECTURE.md)
- **Приватность («Рой»):** приватные задачи и записи видны только владельцу — командный бот их не показывает; страны отображаются короткими ISO-кодами (GE / TR / …)
- Детали — `docs/ARCHITECTURE.md` (swarm-api + miniapp), `docs/MINIAPP_ARCHITECTURE.md`

### bumblebee — запись встреч (macOS)

Лёгкое **меню-бар приложение** для macOS: записывает звук онлайн-звонка и отправляет аудио в Swarm Brain, где сервер транскрибирует его и делает тезисы. Зачем — Read.ai и Granola подключаются не к каждому сервису и не к каждому звонку; bumblebee пишет **любой** онлайн-звонок локально, без внешних интеграций и без локальной AI-модели.

- **Две дорожки звука:** системный звук собеседников (ScreenCaptureKit) + микрофон (AVAudioRecorder) → сервер транскрибирует каждую (Whisper) и сводит по таймстампам с метками «я» / «собеседник»
- **Клиент «тупой»:** никакой LLM на машине — транскрибация и тезисы целиком на сервере (`meeting-claim` → `meeting-ingest`)
- **Без календаря:** дедуп встречи — по комнате из ссылки звонка (Meet / Контур.Толк); авто-детект звонка — по занятости микрофона **с явным согласием** (молча не пишет)
- **Durable-обработка:** длинные встречи режутся на куски, транскрибируются cron-воркером `meeting-process` (переживает лимиты воркера); тезисы — по готовности
- **Установка:** команда из веб → Настройки → bumblebee (из бота — только команда обновления без токена) (`curl … | bash`, ставит `.app` в /Applications без платного Apple-аккаунта); токен — отдельный от Claude Desktop, на год
- Подробности и сборка — **[recorder/README.md](recorder/README.md)**

---

## Деплой

**Прод — свой сервер (VPS Contabo, self-hosted Supabase) с 13.10.2026; раскатка — `make deploy` через шлюз, только по «да» владельца и в ночное окно** — [docs/DEPLOY.md](docs/DEPLOY.md). Команды `supabase functions deploy` ниже — для поднятия **нового** окружения с нуля (облачного прод-проекта больше нет).

```bash
# Edge Functions — всегда с --no-verify-jwt, иначе Telegram/клиент получает 401
supabase functions deploy swarm-bot --no-verify-jwt
supabase functions deploy swarm-mcp --no-verify-jwt
supabase functions deploy swarm-api --no-verify-jwt          # бэкенд веб-интерфейса
supabase functions deploy meeting-claim --no-verify-jwt       # рекордер: claim/lease
supabase functions deploy meeting-ingest --no-verify-jwt      # рекордер: приём аудио
supabase functions deploy meeting-process --no-verify-jwt     # рекордер: cron durable-обработки
supabase functions deploy meeting-heartbeat --no-verify-jwt   # рекордер: heartbeat-мониторинг (алерт при обрыве записи / истечении токена)
supabase functions deploy read-ai-webhook --no-verify-jwt     # Read.ai (отключается)
# granola-poller — LEGACY, выведен из крона; деплоить не нужно. Поллинг Granola идёт через swarm-bot ({"granola_poll":true}, см. Шаг 12 в docs/SETUP.md)

# Веб-интерфейс — статический экспорт → Cloudflare Pages
cd miniapp && npm run build                                   # → miniapp/out/

# bumblebee — сборка .app без платного Apple-аккаунта
cd recorder && ./install.sh                                   # подробности в recorder/README.md
```

В копи-паст примерах (URL вида `https://<YOUR_PROJECT_REF>.supabase.co/...`) подставляй свой project-ref. Прежний облачный прод-проект (`vbqglndbxkpmreccpqmr`) выведен из эксплуатации 13.10.2026 (удаление — [решение](docs/decisions/2026-10-13-cloud-teardown.md)) — не использовать; адрес прода — `SWARM_PUBLIC_URL` (ARCHITECTURE → Переменные окружения).

Рабочая ветка: **`main`** (дефолтная на GitHub; переименована из `sandbox_vas` 2026-07-25).

---

## Ключевые паттерны в коде

**Состояние диалога бота** ([`lib/storage.ts`](supabase/functions/swarm-bot/lib/storage.ts): `setSession / getSession / clearSession`) — таблица `sessions`, одна строка на `chat_id` (TTL 30 минут). Поле `action` — текущий шаг (`waiting_add`, `granola_preview_{noteId}`, `meeting_rename_{id}` и т.п.), `context` — JSON с данными шага.

**Visibility filter** (`storage.ts: visibilityFilter(userId)`) — строка для `.or()` Supabase: возвращает публичные записи + приватные только владельца.

**Оригинал из MCP** (`swarm-mcp/knowledge-add.ts`) — `add_knowledge` сохраняет весь исходный текст одной строкой `entries`, отдельно от тезисов и ограниченного входа для поискового индекса. Контракт и безопасная консолидация исторических частей — [ARCHITECTURE.md](docs/ARCHITECTURE.md#mcp-full-source).

**bgRun** (`index.ts`) — обёртка для async-обработчиков: сразу возвращает 200 Telegram, продолжает работу через `EdgeRuntime.waitUntil`.

---

## Настройка Claude Desktop

См. [SETUP_CLAUDE_DESKTOP.md](./docs/SETUP_CLAUDE_DESKTOP.md)
