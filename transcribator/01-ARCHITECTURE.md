# 01 — Архитектура

## Контекст: что уже есть в Swarm Brain

Репозиторий: `GarroV/Swarm-brain`. Стек: Deno (Supabase Edge Functions), PostgreSQL + pgvector, OpenAI (GPT-4o, Whisper API `/v1/audio/transcriptions`, `text-embedding-3-small`), Telegram Bot API, MCP-сервер для Claude Desktop, веб-версия (Next.js на Cloudflare Pages). Прод-проект Supabase: `vbqglndbxkpmreccpqmr`.

Даунстрим «встреча → база знаний → задачи → эмбеддинги → бот/MCP/веб» уже написан и отлажен под Read.ai/Granola. Swarm Meetings **добавляет новый источник `desktop-agent`** и подключается к этому пайплайну, не переписывая его. Read.ai выключаем в конце месяца; Granola продолжает работать как временный источник, пока не раскатаем свой софт; оба источника уживаются с `desktop-agent` через фильтры по `source`.

Ключевое отличие от мёртвого плана: **транскрибация в облаке, не локально**. Рекордер шлёт аудио — сервер транскрибирует через OpenAI. Это снимает тяжёлый локальный ML и GPU с машин пользователей. Шаг транскрибации сменный: при появлении машины с NVIDIA-GPU можно переехать на локальный Whisper без смены контракта — но это не текущий план, лишь возможность.

## Целевая архитектура

```
┌──────────────────────── macOS (машина участника) ─────────────────────────┐
│  SwarmRecorder — своё лёгкое меню-бар приложение (Swift/AppKit, LSUIElement)│
│  ├── ScreenCaptureKit   — системный звук (удалённые участники) → AAC m4a    │
│  ├── AVAudioRecorder    — микрофон владельца → отдельная AAC m4a            │
│  └── SwarmClient        — claim → upload аудио, ретраи. НОЛЬ LLM-логики     │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ HTTPS (Authorization: Bearer smcp_…)
                                     │ 1) POST /meeting-claim  (JSON)
                                     │ 2) POST /meeting-ingest (multipart: аудио)
┌────────────────────────────────────▼───────────────────────────────────────┐
│  Supabase Edge Functions (Deno) — задеплоено на прод                        │
│  ├── meeting-claim   — координация: кто транскрибирует (claim/lease/defer)  │
│  ├── meeting-ingest  — Whisper (две дорожки) → свод по таймстампам →         │
│  │                     GPT-4o тезисы → meetings.draft_notes_md → уведомление │
│  ├── swarm-api       — очередь вычитки, правка, публикация, экстракция задач │
│  ├── swarm-mcp       — get_meetings и пр. (source-фильтр)                    │
│  ├── swarm-bot       — уведомления, rai_saved (source-фильтр)               │
│  └── PostgreSQL + pgvector: meetings (новая), entries, tasks, allowed_users │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ веб-сессия роя (tma initData / JWT cookie)
┌────────────────────────────────────▼───────────────────────────────────────┐
│  miniapp (Next.js 16, Cloudflare Pages, swarm-brain.pages.dev)              │
│  ├── AgentReviewQueue — очередь на вычитке (раздел «Встречи»)               │
│  └── MeetingReview    — тезисы (редактор), транскрипт под спойлером,         │
│        участники, публикация с выбором базы (команда / личное)              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Модель данных

### Таблица `meetings` — операционная запись встречи

Авторитетна по схеме миграция `supabase/migrations/20260612000000_meetings.sql`. Additive (новая таблица), безопасна на проде. Доступ через Data API — явный `grant` на `service_role`.

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid pk | идентификатор встречи |
| `source` | text (`desktop-agent` \| будущие) | продюсер записи |
| `identity_kind` | text (`calendar` \| `room` \| `manual`) | вид ключа идентичности |
| `identity_key` | text | ключ дедупа реальной встречи |
| `title` | text | название |
| `started_at` / `ended_at` | timestamptz | окно встречи |
| `attendees` | jsonb | участники из календаря, если есть |
| `recorders` | jsonb `[{telegram_id, claimed_at, role}]` | кто реально записал |
| `claim_owner` | bigint → `allowed_users.telegram_id` | кто транскрибирует |
| `lease_expires_at` | timestamptz | TTL claim'а (перехват, если claimer сорвался) |
| `transcript` | jsonb `{language, model, segments:[{start,end,text}]}` | сведённая стенограмма |
| `draft_notes_md` | text | черновик тезисов (до публикации, НЕ в поиске) |
| `notes_edited_at` | timestamptz | человек правил черновик → не перегенерировать |
| `entry_id` | uuid → `entries.id` | публикуемая запись (при аппруве) |
| `group_id` | text → `workspaces.id` | воркспейс; резолвится из токена владельца, НЕ из payload |
| `status` | text (`awaiting_review` \| `in_base`) | стадия жизненного цикла |
| `agent_version` | text | версия рекордера |

Уникальный индекс `meetings_identity_key_uq` на `identity_key` `WHERE identity_kind <> 'manual'` — детерминированно разрешает гонку нескольких записавших по одной встрече. `manual` исключён (он уникален сам, авто-дедупу не подлежит).

### `meetings` ↔ `entries` (тезисы) — 1:1, создаётся ТОЛЬКО при публикации

`entries` — это искомый артефакт (получает эмбеддинг, семантический поиск, изоляцию по `group_id`, приватность `is_private`/`owner_id`). **До публикации записи в `entries` нет.** Черновик тезисов живёт только в `meetings.draft_notes_md` и в поиск/базу знаний не попадает. На аппруве `swarm-api` создаёт одну запись в `entries` (`entry_type=transcript`, `source=desktop-agent`, `metadata.meeting_id`), привязывает её через `meetings.entry_id` и ставит `status=in_base`.

### Личные пометки участника — приватные `entries`, без отдельной таблицы

Пометки конкретного участника со встречи сохраняются как приватная запись в `entries` (`is_private=true`, `owner_id=<его telegram_id>`, `entry_type=meeting_note`, `metadata={meeting_id, kind:"personal_notes"}`). Отдельной таблицы НЕТ — переиспользуем личное хранилище и поиск «своё + общее». Итог по одной встрече: **1 общая (публикуемая) entry тезисов + N приватных entry-пометок** разных участников.

## Принципы разделения ответственности

| Компонент | Что делает | Чего НЕ делает |
|---|---|---|
| SwarmRecorder (`recorder/`) | запись двух дорожек, claim, загрузка аудио, ретраи | НЕ транскрибирует, НЕ генерит тезисы, НЕ хранит истину, ноль LLM |
| `meeting-claim` | координация: claim/lease/defer, регистрация записавшего, сохранение личных пометок | НЕ транскрибирует |
| `meeting-ingest` | транскрибация (Whisper), свод дорожек, тезисы (GPT-4o), черновик, уведомление | НЕ публикует в базу знаний, НЕ создаёт `entries`-тезисы |
| `swarm-api` | очередь вычитки, правка черновика, публикация (выбор базы), экстракция задач | НЕ транскрибирует, НЕ перегенерирует тезисы автоматически |
| miniapp | вычитка/правка тезисов человеком, аппрув, просмотр транскрипта | НЕ перегенерирует тезисы без явного действия |

Агент намеренно «тупой»: чем меньше логики на клиенте, тем реже обновления и меньше поддержки.

## Рекордер (`recorder/`) — своё macOS-приложение

Не форк, не Tauri/Rust. Swift/AppKit, меню-бар (`LSUIElement`), bundle id `io.dodobrands.swarmrecorder`, минимальная macOS 13. Файлы `Sources`: `SwarmTypes` (Config + Codable-модели), `SwarmClient` (claim + upload + ретраи), `AudioRecorder` (две дорожки), `Permissions`, `AppDelegate`, `main`.

- **Две дорожки.** `ScreenCaptureKit` пишет системный звук (удалённые участники), `AVAudioRecorder` — микрофон владельца. Обе → AAC m4a. Сервер сводит их по таймстампам с метками `собеседник`/`я`.
- **Сборка без полного Xcode.** SwiftPM + ручная сборка `.app`-бандла + ad-hoc codesign (скрипт `build-app.sh`); `.xcodeproj` не обязателен. Режим `--selftest` прогоняет весь цикл (e2e доказан).
- **Разрешения TCC.** Запись экрана/системного звука — System Settings → Privacy → Screen Recording (пользователь выдаёт при первом запуске, возможно заново после пересборки — известное неудобство). Микрофон — `NSMicrophoneUsageDescription`.
- **Конфиг** `~/Library/Application Support/SwarmRecorder/config.json`: персональный `smcp_`-токен (из бота, `/mytoken`) + `ingestBaseURL` + опц. `webBaseURL`.

Скоуп захвата — только онлайн-звонки: Google Meet и Контур.Толк (id комнаты из URL вкладки), Telegram-звонок (кнопка резкого старта; сюда же редкие офлайн-записи одним человеком), редко Zoom, почти никогда Teams. Переговорки/диктофон для комнат не проектируем.

Распространение бинаря без платного аккаунта Apple — открытый вопрос; для запуска достаточно ad-hoc подписи.

## Потоки данных: claim → ingest → draft → publish

```
Записывают ВСЕ участники локально
        │
        ▼  перед загрузкой — POST /meeting-claim {identity_kind, identity_key, started_at,
        │                     ended_at, title?, attendees?, user_notes?, agent_version}
   meeting-claim:
     • ключа нет        → создаёт meetings(awaiting_review), claim_owner=я, lease →
                           ответ decision=transcribe
     • ключ уже есть     → атомарный условный апдейт по lease:
                           lease свободен/истёк → перехват → transcribe
                           lease занят активным → defer (этот агент аудио НЕ грузит)
     • регистрирует записавшего в recorders
     • user_notes → приватная entry (best-effort, сбой не валит claim)
        │  ответ {meeting_id, decision, lease_ttl_sec}  (TTL = 1800 c)
        ▼  claimer (decision=transcribe) грузит аудио:
        │  POST /meeting-ingest  multipart: meeting_id + audio (системный, обязателен, ≤25МБ)
        │                                            + audio_mic (микрофон, опц., ≤25МБ)
   meeting-ingest (только claim_owner; чужая заливка → 403):
     • notes_edited_at != null → пропуск (защита человеческой правки)
     • 202 + фон (EdgeRuntime.waitUntil):
         Whisper обеих дорожек (verbose_json) → свод сегментов по таймстампам
         (метки собеседник/я) → meetings.transcript → GPT-4o тезисы → draft_notes_md
       → уведомление всем записавшим (кнопка «Открыть» при заданном WEB_BASE_URL)
        │
        ▼  любой из записавших открывает вычитку в miniapp:
   swarm-api (веб-сессия роя):
     GET  /agent-meetings?status=…      — очередь / опубликованные (свои или админ)
     GET  /agent-meetings/:id           — черновик + транскрипт + участники
     PATCH /agent-meetings/:id          — правка draft_notes_md → notes_edited_at
     POST /agent-meetings/:id/publish {base: workspace|personal}
        • создаёт entry с эмбеддингом (text-embedding-3-small)
        • привязывает entry_id, status=in_base (идемпотентно, гонка-гард)
        • personal → is_private + owner_id
        • createMeetingTasks: GPT-4o-mini извлекает задачи из draft_notes_md →
          createTask (привязка meeting_id, резолв исполнителя по имени,
          наследование приватности). Сбой извлечения НЕ валит публикацию.
        │
        ▼ status=in_base → из очереди на вычитке встреча ушла у всех разом,
          entry попала в базу знаний (поиск, бот, MCP, веб), задачи извлечены.
```

Лимит файла OpenAI — 25 МБ. Компактный AAC m4a даёт ~10 МБ/час; длинные встречи резать/жать (это TODO на стороне рекордера). Стоимость ~$0.36/час встречи на транскрибацию + центы на тезисы.

## Идентичность и дедуп

Приоритет ключа `identity_key`:

1. **calendar** — `<iCalUID>:<YYYY-MM-DD>` (с датой экземпляра для повторяющихся встреч).
2. **room** — `meet:<code>` / `kontur:<room>` (id комнаты из URL звонка).
3. **manual** — `manual:<uuid>` (Telegram/кнопка; без авто-дедупа).

Авто-схлоп нескольких записавших — только по точным ключам (`calendar`/`room`) через уникальный индекс. Никакого content-similarity. Кросс-источник (Granola) и `manual` объединяются вручную в вебе (warn-at-add).

## Где какая защита

`SERVICE_ROLE_KEY` используется везде — RLS не защищает. **Вся проверка доступа — только в коде.**

- **Аутентификация агента — `_shared/agent-auth.ts` (`verifyAgentToken`).** Персональный `smcp_`-токен в `Authorization: Bearer`; SHA-256-хэш сверяется с `allowed_users.claude_mcp_token_hash`; функция возвращает `{telegramId, groupId}`. Личность И `group_id` берутся ИЗ ТОКЕНА, не из payload — спуфинг невозможен. Это НЕ статический общий секрет; токен личный, с TTL 90 дней (механизм зеркалит swarm-mcp).
- **`meeting-ingest`** дополнительно проверяет, что заливающий = `claim_owner` встречи (иначе 403).
- **Аутентификация веба — веб-сессия роя в `swarm-api`:** `tma <initData>` (Telegram Mini App, `verifyInitData`) или `Bearer <JWT>` (httpOnly cookie, проксируется CF Pages Function). `group_id` и `is_admin` резолвятся из `allowed_users` по `telegram_id`. Доступ к встрече: запись видна записавшим (`recorders` содержит твой `telegram_id`) или админу; чужая встреча → 404.
- **Изоляция `entries` — `swarm-api/entries-guard.ts`.** Прямые запросы к `entries` в эндпоинтах swarm-api запрещены: `getEntrySecure` / `buildEntriesQuery` применяют воркспейс-изоляцию (`group_id`) и приватность (`is_private=false OR owner_id=telegramId`); для мутаций — `requireOwner: true` (403 не-владельцу). Хендлеры обёрнуты в `withEntries` (ловит `EntryAccessError` → корректные 404/403).

## Сосуществование источников (переходный период)

Видимость `source=desktop-agent` добавлена в основные выборки встреч: `swarm-api` `GET /meetings` и `swarm-mcp` `get_meetings` (`source IN (read_ai, granola, desktop-agent)`), а также список сохранённых в боте (`handlers/meetings.ts`: `source IN (read_ai, voice, desktop-agent)`, при этом `granola` подхватывается соседней веткой `entry_type IN (transcript, meeting)`, а не по `source`). **Пробел покрытия:** прочие бот-выборки в `index.ts` (статистика хранилища, «последняя встреча», счётчик ожидающих) пока фильтруют только `[read_ai, granola]` — `desktop-agent` в них ещё не добавлен (мелкий TODO). Так Read.ai (выключаем), Granola (временно работает) и новый `desktop-agent` уживаются в боте/вебе/MCP.

## Ядро (не обсуждается)

Каждая встреча проходит обязательную предварительную вычитку человеком + ручной аппрув + выбор базы (команда/личное). Никакой источник не минует вычитку и не публикуется автоматически. Безопасность личного хранилища: приватные пометки и личная публикация всегда несут `is_private` + `owner_id` и наследуют приватность в извлечённые задачи.

## Отказоустойчивость и идемпотентность

- **Координация записи.** Несколько участников пишут одну встречу; claim+lease отдаёт транскрибацию одному. Сорвался claimer → по истечении lease перехватывает другой записавший. Сервер транскрибирует один раз.
- **Заливка аудио.** `meeting-ingest` идемпотентен по `meeting_id`: повторный POST после человеческой правки (`notes_edited_at != null`) пропускается; фоновая обработка через `EdgeRuntime.waitUntil` гасит дубли от ретраев агента.
- **Публикация.** Гонка-гард на `meetings.entry_id IS NULL` — параллельные publish не плодят дубликаты `entries`; повторная публикация возвращает уже привязанную запись.
- **Личные пометки.** Сохранение в `meeting-claim` идемпотентно (обновляет ту же entry, а не плодит копии) и best-effort (сбой не валит координацию).
