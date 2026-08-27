# Swarm Brain

**Командная база знаний, которая помнит за вас.** Итоги встреч, задачи и документы команды — в одном месте, с ответами на обычном языке. Работает там, где команда уже сидит: в Telegram, в браузере, в Claude Desktop и с собственного рекордера звонков на Mac — bumblebee.

## 🔗 Живое демо — зайти за 10 секунд, без регистрации

### **[→ Открыть демо-воркспейс](https://swarm-brain.pages.dev/api/auth/demo?key=f4a2bc8e3401d76455aa3e9243cecc1583616b61d105cdfd)**

**Знания команды перестают теряться в чатах, дисках и чужих головах.** Swarm Brain держит встречи, задачи и документы в одном месте и отвечает на вопросы обычным языком — из Telegram, браузера или Claude Desktop, а bumblebee сам пишет и расшифровывает встречи. Одна база — четыре двери, что создал в одной, видно в остальных.

В демо уже наполнен рабочий день команды. Что попробовать:

- 🔎 **Спросите базу, как живого коллегу** — «что решили по Сербии?» → ответ со ссылками на источники вместо получаса листания переписки.
- ✅ **Задачи рождаются сами из встреч** — расшифровка → тезисы → готовые задачи с исполнителями и странами. Доска, спринт, граф зависимостей, срезы «мои / команда / по рынкам».
- 🎙 **Встречи записываются и расшифровываются без вас** — bumblebee на Mac или Granola → сервер делает стенограмму и тезисы, вам остаётся вычитать и опубликовать одним касанием.
- 📊 **Утренний дайджест по вашим рынкам** — что произошло за неделю, собрано автоматически, без ручной сводки.

Это изолированная витрина: тыкайте, создавайте, ломайте — рабочих данных не заденете, всё возвращается к эталону.

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
| Веб-интерфейс «Рой» | браузер: Telegram Login Widget → JWT (вход как Telegram Mini App отключён) | `swarm-api` |
| Claude Desktop (MCP) | токен + команда установки из `/setup` в боте **или веб → Настройки → Claude Desktop** | `swarm-mcp` |
| bumblebee | macOS меню-бар; установка из `/recordertoken` **или веб → Настройки → bumblebee** | `meeting-claim`, `meeting-ingest`, `meeting-process` |
| Granola | API-ключ на пользователя (`/connect granola`), часовой поллинг → единая приёмная встреч (`meetings`) | `swarm-bot` (`granola_poll`) |
| Read.ai | OAuth2 + webhook — **отключается** (`READ_AI_ENABLED` off, не развивается) | `read-ai-auth`, `read-ai-webhook` |

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
│   ├── swarm-api/              # REST API для веб-интерфейса (поверх той же логики, что и бот)
│   ├── meeting-claim/          # Рекордер: claim/lease встречи до транскрибации
│   ├── meeting-ingest/         # Рекордер: приём аудио → Storage → durable-обработка
│   ├── meeting-process/        # Рекордер: cron durable-обработки (транскрибация по кускам + тезисы)
│   ├── meeting-heartbeat/      # Рекордер: heartbeat-мониторинг (watchdog checkRecorderHealth в swarm-bot)
│   ├── granola-poller/         # LEGACY: standalone-поллер, выведен из крона. Поллинг Granola — внутри swarm-bot (ingestNewGranolaNotesAllUsers)
│   ├── read-ai-auth/           # OAuth2 авторизации Read.ai (отключается)
│   ├── read-ai-webhook/        # Вебхук Read.ai (отключается, READ_AI_ENABLED off)
│   └── _shared/                # общий код: sources (реестр источников), mcp-token, recorder-token, meeting-processor, meeting-dedup, tasks, search, countries
└── migrations/                 # ВСЯ схема: 00000000_initial_schema.sql + инкрементальные. Старт с нуля — supabase db reset (или db push)

miniapp/                        # Веб-интерфейс «Рой» (Next.js 16 → статический экспорт → Cloudflare Pages; имя папки историческое — это обычный сайт/PWA, НЕ Telegram Mini App)
└── src/                        # Поиск/RAG, доска задач, база знаний, вычитка встреч

recorder/                       # bumblebee — macOS меню-бар рекордер встреч (Swift)
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
| `task_comments` | Комментарии-апдейты к задачам (веб + MCP) |
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

Полный список команд роутера `swarm-bot` (26). Часть команд в меню Telegram (`setMyCommands`) не выводится — они доступны вводом вручную или из `/help`.

| Категория | Команды |
|-----------|---------|
| Знания | `/add` — добавить запись · `/ask` — задать вопрос · `/status` — состояние базы |
| Встречи | `/meetings` — инбокс на подтверждение · `/granola` — ручной импорт Granola · `/connect granola <ключ>` — подключить Granola · `/disconnect granola` — отключить |
| Задачи | `/tasks` — активные задачи (фильтры по имени/стране) · `/addtask` — создать задачу |
| Команда | `/users` — управление командой и профилями |
| Claude Desktop | `/setup` — авто-подключение (one-liner) · `/connect_claude` — инструкция по подключению · `/claude` — инструкции для проекта · `/mytoken` — выдать MCP-токен · `/revoketoken` — отозвать MCP-токен |
| bumblebee | `/recordertoken` — токен bumblebee · `/revokerecordertoken` — отозвать его |
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
- **Из встречи** — по кнопке «Сгенерировать задачи» на экране вычитки (preview → добавить, привязка `meeting_id`); авто-извлечение из транскрипта в боте (`analyzeAndCreateTasks`)
- Смарт-поиск: если вопрос содержит TASK_KEYWORDS — сначала ищет в задачах

### Роли пользователей и назначение задач

Профили имеют роли: `marketing`, `bd` (бизнес + операционка), `rnd` (продукт).
При извлечении задач из транскрипта GPT определяет исполнителя по каскаду:
имя/email/псевдоним → роль+страна → только страна → общий пул.
Несколько исполнителей в стране — задача назначается всем. Редактируется через админку профилей.

### MCP-сервер (Claude Desktop + claude.ai)
Два пути подключения (инструкция в боте — `/connect_claude`): **(A) Claude Desktop на Mac** — `/setup` (one-liner для терминала ставит мост `mcp-remote` + пишет `config.json`) или веб → Настройки → Claude Desktop; **(B) claude.ai в браузере** — `/mytoken` даёт токен, вставляется вручную в Settings → Connectors (URL `swarm-mcp` + Bearer). Токен **бессрочный** — по времени не истекает; «протух»/`Invalid token` = рассинхрон (клиент шлёт старый токен), а не срок. Ни `/setup`, ни `/mytoken`, ни `/recordertoken` не перевыпускают токен молча при активном — перевыпуск убивает старый и рвёт рабочее подключение, поэтому просят подтверждения кнопкой. Хелперы токена — `_shared/mcp-token.ts` (бот и веб — тонкие двери).

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
| `get_task_comments` | Комментарии-апдейты к задаче по её ID |
| `add_task_comment` | Добавить комментарий-апдейт к задаче от своего лица |

### Веб-интерфейс «Рой»

Весь функционал бота доступен и в графическом UI — **обычный веб-сайт (PWA)** в браузере. Кодовое имя — «Рой». _(Раньше открывался и как Telegram Mini App внутри Telegram — этот вход **отключён**, бот теперь ведёт на PWA. Папка `miniapp/` — историческое имя каталога.)_

- **Стек:** Next.js 16 + React 19 + Tailwind + shadcn; статический экспорт, хостинг — Cloudflare Pages (`swarm-brain.pages.dev`)
- **Бэкенд:** edge-функция `swarm-api` — REST поверх той же бизнес-логики, что и бот (новой логики нет, только маршруты)
- **Вход:** в браузере — Telegram Login Widget → JWT в httpOnly-cookie. _(Спящий путь `initData`/`tma` для Mini App ещё есть в коде `swarm-api`, но точки входа нет — на удаление, см. `docs/BACKLOG.md`.)_
- **Экраны:** поиск + AI-ответ (RAG со сносками), доска задач (десктоп — виды Список / Таймлайн / Спринт / Граф; линзы Мои / Команда / Все; для админа — «Все сотрудники» с группировкой по исполнителю), база знаний, встречи + вычитка и публикация. Адаптив: мобайл — таб-бар, десктоп — бенто-дашборд
- **Настройки** («Ещё»): профиль/рынки, Granola, Google-календарь, дайджест, загрузка файла, фидбек, **bumblebee** и **Claude Desktop** — установка из веба (зеркало `/recordertoken` и `/setup`)
- **Админка** (для админов): воркспейсы (создать/переименовать), пользователи (добавить/переместить/удалить, правка профилей), broadcast, сводка «на вычитке по участникам» — паритет с бот-суперадмином
- **Админ = суперадмин:** `isAdmin = зашитый ADMIN_USER_ID ИЛИ флаг allowed_users.is_admin` (мультиадмин); админ видит все данные воркспейса
- **Приватность («Рой»):** приватные задачи и записи видны только владельцу — командный бот их не показывает; страны отображаются короткими ISO-кодами (GE / TR / …)
- Детали — `docs/ARCHITECTURE.md` (swarm-api + miniapp), `docs/MINIAPP_ARCHITECTURE.md`

### bumblebee — запись встреч (macOS)

Лёгкое **меню-бар приложение** для macOS: записывает звук онлайн-звонка и отправляет аудио в Swarm Brain, где сервер транскрибирует его и делает тезисы. Зачем — Read.ai и Granola подключаются не к каждому сервису и не к каждому звонку; bumblebee пишет **любой** онлайн-звонок локально, без внешних интеграций и без локальной AI-модели.

- **Две дорожки звука:** системный звук собеседников (ScreenCaptureKit) + микрофон (AVAudioRecorder) → сервер транскрибирует каждую (Whisper) и сводит по таймстампам с метками «я» / «собеседник»
- **Клиент «тупой»:** никакой LLM на машине — транскрибация и тезисы целиком на сервере (`meeting-claim` → `meeting-ingest`)
- **Без календаря:** дедуп встречи — по комнате из ссылки звонка (Meet / Контур.Толк); авто-детект звонка — по занятости микрофона **с явным согласием** (молча не пишет)
- **Durable-обработка:** длинные встречи режутся на куски, транскрибируются cron-воркером `meeting-process` (переживает лимиты воркера); тезисы — по готовности
- **Установка:** команда из `/recordertoken` в боте **или** веб → Настройки → bumblebee (`curl … | bash`, ставит `.app` в /Applications без платного Apple-аккаунта); токен — отдельный от Claude Desktop, на год
- Подробности и сборка — **[recorder/README.md](recorder/README.md)**

---

## Деплой

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

В копи-паст примерах (URL вида `https://<YOUR_PROJECT_REF>.supabase.co/...`) подставляй свой project-ref. Прод-реф Dodo Brands — `vbqglndbxkpmreccpqmr`.

Рабочая ветка: **`main`** (дефолтная на GitHub; переименована из `sandbox_vas` 2026-07-25).

---

## Ключевые паттерны в коде

**Сессии** (`storage.ts: setSession / getSession / clearSession`) — хранят состояние диалога в `app_settings`. Формат ключа: `session_{chatId}`. Поле `action` — текущий шаг (`waiting_add`, `granola_preview_{noteId}`, `meeting_rename_{id}` и т.п.), `context` — JSON с данными шага.

**Visibility filter** (`storage.ts: visibilityFilter(userId)`) — строка для `.or()` Supabase: возвращает публичные записи + приватные только владельца.

**Chunking** (`add_knowledge` в swarm-mcp) — тексты >3000 символов бьются на чанки с overlap 200 символов; связаны через `group_id`. Первый чанк хранит `summary` и `embedding`; остальные — только `content`.

**bgRun** (`index.ts`) — обёртка для async-обработчиков: сразу возвращает 200 Telegram, продолжает работу через `EdgeRuntime.waitUntil`.

---

## Настройка Claude Desktop

См. [SETUP_CLAUDE_DESKTOP.md](./SETUP_CLAUDE_DESKTOP.md)
