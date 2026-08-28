# Swarm Brain — Architecture

> **Для Claude Code:** этот файл — глубокий **reference** (инвентари + флоу). Чтобы быстро найти «где что лежит», НЕ перечитывай его целиком — открой **🧭 Навигационный индекс** в [QUICK_REF.md](QUICK_REF.md) (concern → файлы → раздел тут). Сюда приходи за деталями раздела, на который указал индекс. После изменений — обновляй соответствующий раздел сразу (см. [QUICK_REF → Правила после изменений](QUICK_REF.md)).

## Что такое Swarm Brain

Командная база знаний с AI-поиском, управлением задачами и интеграцией встреч — для распределённых команд. Цель: собрать в одном месте всё, что знает команда (заметки, документы, договорённости, итоги встреч, ссылки), и сделать это мгновенно доступным на естественном языке, не выходя из инструментов, где команда уже работает.

**Проблема, которую решает:** институциональное знание расползается по чатам, головам и встречам — новый человек или коллега с другого рынка не может быстро поднять контекст. Swarm Brain централизует знание и отвечает на вопросы по содержимому базы со ссылками на источники, а не «по памяти».

**Кто пользуется:** распределённые команды международного бизнеса. Текущее развёртывание — Dodo Brands, рынки CEE и Other (домен — общепит/доставка: пиццерии в Сербии, Болгарии, Хорватии, Венгрии, Молдове, Румынии и др.). Изоляция данных — по воркспейсам, которые маппятся на группы рынков (`cee` / `other`).

## Поверхности продукта

Четыре пользовательские поверхности поверх одного бэкенда (Supabase Edge Functions + Postgres/pgvector + OpenAI):

| Поверхность | Технология | Для чего | Бэкенд |
|---|---|---|---|
| **Telegram-бот** | Deno Edge Function | **Уведомления** — тезисы готовы, комментарии к задачам, дайджест, ежедневный отчёт, напоминания. Команды ввода и поиска в нём есть и работают, но **роль бота — уведомлять**, а не вводить (решение владельца 2026-08-27, [decisions/2026-08-27-bot-is-notifications.md](decisions/2026-08-27-bot-is-notifications.md)): ввод живёт в вебе и Claude Desktop, через бота за 30 дней приходит ~1 запись, и это ожидаемое состояние, а не поломка. Бот — единственная поверхность, которая сама приходит к человеку, поэтому доставляемость важнее богатства функций | `swarm-bot` |
| **Веб-интерфейс «Рой»** | Next.js (static export) → Cloudflare Pages, браузер/PWA | Доска задач (Задачи/**Спринт** — swimlane-секции по проектам + колонка Бэклог), RAG-поиск, вычитка встреч. Вкладки «Таймлайн» (**отключена 2026-08-19**, код `TimelineView` паркован) и «Проекты» (react-flow дерево, **отключена 2026-08-06**, код паркован) — временно скрыты, обе доступны к возврату раскомментированием строки в `TasksScreen.tsx` | `swarm-api` |
| **Claude Desktop (MCP)** | MCP-сервер | Та же база + инструменты внутри Claude Desktop (большие тексты, с проверкой человеком) | `swarm-mcp` |
| **bumblebee** | macOS-приложение (Swift) | Запись звука онлайн-встреч → облачная транскрибация → тезисы в базу | `meeting-claim`, `meeting-ingest`, `meeting-process`, `meeting-status` |

> **Имя рекордера.** Снаружи приложение называется **bumblebee** (строчными, латиницей) — в
> `/Applications`, в Privacy & Security, во встречах и в текстах бота. Внутри всё осталось прежним
> намеренно: bundle id `io.dodobrands.swarmrecorder`, cert «SwarmRecorder Self-Signed», папка
> `~/Library/Application Support/SwarmRecorder/`, `source=desktop-agent`, имена функций
> `swarm-recorder-*` и артефакт `SwarmRecorder-<N>.zip` — на первых двух висит TCC-грант на запись
> системного звука, остальное — ключи данных. Канон:
> [decisions/2026-08-28-recorder-renamed-bumblebee.md](decisions/2026-08-28-recorder-renamed-bumblebee.md).
> Переходный релиз (build 24): бандл внутри архива пока `SwarmRecorder.app`, приложение
> переименовывает себя само при первом запуске (`Updater.runBundleRename`).

## Сквозные сценарии

1. **Захват.** Переслать боту текст / файл / голос / ссылку → сохраняется в базу (генерятся тезисы, эмбеддинг, страны и тип записи).
2. **Поиск / ответ.** Вопрос боту или в вебе → гибридный поиск (смысл + точные слова; когда в запросе названа страна — **фильтр** по ней + общекомандные `General`, чужие страны отсекаются; буст свежести) + RAG-ответ со сносками на источники.
3. **Встречи.** Read.ai / Granola авто-импорт или bumblebee → черновик «на согласовании» → правка/подтверждение в вебе или Telegram → запись в базе. Задачи **не** генерятся автоматически — пользователь жмёт «Сгенерировать задачи» в ревью/на экране встречи.
4. **Задачи.** Сгенерированы из встречи по кнопке или созданы вручную → назначение и трекинг (спринты, зависимости, таймлайн — в вебе).
5. **Claude Desktop.** Та же база и те же операции через MCP-инструменты (по персональному токену).

## Глоссарий

- **«Рой»** (Swarm по-русски) — веб-интерфейс продукта (браузер/PWA). Папка `miniapp/` — историческое имя каталога; вход как **Telegram Mini App отключён** (~2026-07-15, коммит `53bd3ae` — бот ведёт на PWA). Не называть веб «mini app».
- **Воркспейс** (workspace, поле `group_id`) — тенант, единица изоляции данных; маппится на группу рынков (`cee` / `other`).
- **entry** — запись базы знаний (таблица `entries`). **meeting** — источник истины о встрече рекордера (таблица `meetings`). Это разные сущности, не путать.
- **`/meetings`** — подтверждённые записи-встречи в `entries`; **`/agent-meetings`** — черновики рекордера в `meetings` до публикации.
- **claim / lease** — право на транскрибацию встречи, выдаваемое одному из записавших (чтобы не транскрибировать дубли).
- **`confirmed:false`** — «на согласовании»: встреча сохранена, но ждёт подтверждения в вебе или Telegram.

## Ветка и деплой (канон)

- Разработка в ветке **`main`** (дефолтная; переименована из `sandbox_vas` 2026-07-25).
- Edge Functions: `supabase functions deploy <name> --no-verify-jwt`. **Инвариант:** `verify_jwt = false` закреплён для всех функций в `supabase/config.toml` (`[functions.<name>]`) — деплой не должен молча терять публичность шлюза. **Никогда не ставить `verify_jwt = true`**: все функции делают свою авторизацию в коде (recorder/MCP-токен, сессионный JWT, вебхук-секрет) и шлют не-JWT `Bearer`, который шлюз с verify_jwt отобьёт 401 `INVALID_JWT_FORMAT` ещё до функции (так 2026-06-30 молча падали ВСЕ загрузки рекордера — разбор в QUICK_REF/BACKLOG).
- Веб-интерфейс: `cd miniapp && npm run build` → `out/` → Cloudflare Pages.
- Прод project-ref: `vbqglndbxkpmreccpqmr` (развёртывание Dodo Brands). `ADMIN_USER_ID = 744230399` зашит в `swarm-bot/lib/supabase.ts`.

## Стек

- **Runtime:** Deno (Supabase Edge Functions)
- **БД:** Supabase Postgres + pgvector
- **AI:** OpenAI — тезисы встреч `gpt-5.6-terra` (фолбэк `gpt-4o`), прочий chat `gpt-4o-mini`, поиск `text-embedding-3-small`, транскрибация `whisper-1`
- **Bot:** Telegram Bot API (webhook)
- **Источники встреч:** Granola API, Read.ai (webhook)

---

## Edge Functions

| Функция | Триггер | Назначение |
|---------|---------|-----------|
| `swarm-bot` | Telegram webhook POST | Главный бот — весь пользовательский флоу |
| `swarm-bot` (`granola_poll`) | Cron (каждый час) | Импортирует новые заметки Granola как черновики `confirmed:false` (видны в вебе «на согласовании» + Telegram-ревью). Заменил standalone `granola-poller` |
| `swarm-bot` (`daily_report_cron`) | Cron (раз в сутки, ~06:00 UTC) | Ежедневный отчёт активности админу: счёт `entries` за вчерашние сутки (Europe/Belgrade) по `entry_type` (meeting/note) → `sendMessage(ADMIN_USER_ID)`. Вывод (переделан 2026-07-25): «📥 Добавлено в базу: N» + список названий (встречи+документы, из `metadata.title`/первой строки) + «📋 На вычитке: M» (вся очередь `meetings.status=awaiting_review`); «тихий день» — только когда оба ноль. Тот же флоу дублирует команда `/report`. Хендлеры `handlers/daily-report.ts` (чистое ядро — `yesterdayWindow`/`aggregateActivity`/`formatReport`) + `handlers/daily-report-send.ts` (I/O `sendDailyReport()` — запрос + отправка) |
| `swarm-bot` (`task_pings_cron`) | Cron (почасовой, pg_cron `task-pings-hourly`) | «Пинги» задач: наступившие ручные напоминания (`tasks.remind_date <= сегодня`, `reminded_at is null`, задача не закрыта) → сообщение в Telegram с кнопкой в веб (`/?task=<id>`) + строка в ленте-колокольчике (`notifications.type='task_reminder'`). Пинг ОДНОРАЗОВЫЙ: после отправки `reminded_at`, повторов нет (решение владельца 2026-08-26). Получатели — исполнители; общая задача без исполнителя → поставивший пинг (`remind_set_by`); приватная → владелец. Не сумели отправить (человек не запускал бота) — пинг НЕ гасим, повторим на следующем тике; некому отправить вовсе — гасим с `console.warn`, иначе задача крутилась бы в выборке вечно. Гейта рабочих часов НЕТ (день выбрал человек, тик — почасовой). Хендлеры `handlers/task-pings.ts` (ядро: `isPingDue`/`pingRecipients`/`groupByRecipient`/`formatPings`, покрыто `task-pings.test.ts`) + `handlers/task-pings-send.ts` (I/O `sendTaskPings()`) |
| `swarm-bot` (`review_reminders_cron`) | Cron (почасовой, pg_cron `review-reminders-hourly`; гейт рабочих часов Белграда — будни 9–19 — в коде) | Напоминалка **владельцу** про его невычитанные встречи-записи (`entries` `confirmed!=true`) старше 48ч: сообщение с кнопкой в веб (`/?meeting=<id>`), дальше каждые 24ч до вычитки. Антиспам — `entries.last_review_reminded_at`. Уводит из Telegram в веб (решение владельца 2026-07-25). Хендлеры `handlers/review-reminders.ts` (ядро: `isWorkingHours`/`selectDueReminders`/`formatReminder`) + `handlers/review-reminders-send.ts` (I/O `sendReviewReminders()`) |
| `swarm-bot` (`feedback_retention_cron`) | Cron (раз в сутки; требует `X-Cron-Secret`) | Чистка Storage: удаляет закрытый фидбек (`status` done/wontfix, `resolved_at` старше 90 дней) вместе со скринами в `swarm_drive`. Незакрытый (`new`/`triaged`) не трогает. Хендлер — `handlers/feedback.ts` `cleanupOldFeedback()` |
| `granola-poller` | ⚠️ выведен из крона | Устаревшая standalone-функция: только слала уведомление в Telegram, в БД ничего не клала. Логика переехала в `swarm-bot` (`ingestNewGranolaNotesAllUsers`) |
| `read-ai-webhook` | Webhook от Read.ai | Принимает завершённые встречи, сохраняет в `entries`, уведомляет бота |
| `read-ai-auth` | HTTP redirect (OAuth) | OAuth callback для авторизации Read.ai, сохраняет токен в `app_settings` |
| `swarm-mcp` | MCP (Claude Desktop) | MCP-сервер для Claude Desktop: поиск, добавление знаний, управление задачами |
| `swarm-setup` | HTTP GET (публичный) | Отдаёт bash-скрипт авто-подключения Claude Desktop (macOS). Юзер запускает его через `/setup` в боте: `curl -fsSL …/swarm-setup \| SWARM_TOKEN=… bash`. Скрипт проверяет токен на сервере (`tools/call`, ДО записи конфига), кладёт **мост stdio↔HTTP на `bash`+`curl`** в `~/.swarm-brain/bin/swarm-mcp-bridge.sh`, мёржит блок `swarm-brain` (`command: /bin/bash`, адрес и токен — в `env`) в `claude_desktop_config.json` штатным `plutil`, убирает Node от прежней схемы и рестартит Claude. Без секретов в самом скрипте. Текст — `swarm-setup/script.ts` (`SETUP_SCRIPT`, `BRIDGE_SCRIPT`, `MERGE_FUNCTION`), тесты — `script.test.ts`. **Node убран 2026-08-25 (issue #47):** раньше ради `mcp-remote` качались Node с `nodejs.org` и пакет с `registry.npmjs.org` — три сетевые точки отказа, которые рубит корпоративный VPN, ради одной функции «подставить заголовок `Authorization`». ⚠️ Проверка валидности конфига — только `plutil -convert json -o /dev/null`, **не `plutil -lint`**: lint ждёт property list и объявляет битым любой валидный JSON. ⚠️ Мост синхронный (запрос→ответ): серверных событий SSE — прогресса, `tools/list_changed`, `sampling`, стриминга — не поддерживает; `swarm-mcp` объявляет только `capabilities: { tools: {} }` и ничего не пушит, поэтому потерь нет (issue #94 — бинарник, когда понадобятся) |
| `swarm-recorder-setup` | HTTP GET (публичный) | Отдаёт bash-установщик bumblebee (macOS). Юзер запускает через `/recordertoken`: `curl -fsSL …/swarm-recorder-setup \| SWARM_TOKEN=… bash`. **Схема — ПРЕДсобранный .app, БЕЗ Xcode/Command Line Tools на машине юзера (issue #19, 2026-08-11).** Скрипт: валидирует токен → узнаёт `{build,url}` у `swarm-recorder-version` → `curl` качает готовый `SwarmRecorder-<N>.zip` (**публичный бакет Storage `swarm_drive/recorder/`**, НЕ GitHub — см. ниже) → `ditto` распаковывает → `xattr -dr com.apple.quarantine` (иначе Gatekeeper блокирует скачанное) → создаёт per-machine self-signed cert **штатными `/usr/bin/openssl` + `security`** (CLT НЕ нужен; без доверия/пароля, идемпотентно) → `codesign` переподписывает этим cert'ом (DR на cert leaf → TCC стабилен) → `cp` в /Applications → авто-запись `config.json` с токеном → `open`. `git clone` + `swift build` + требование CLT УБРАНЫ (были причиной падений у нетех-юзеров). Текст — `swarm-recorder-setup/script.ts`. Сборку .app делает CI (`.github/workflows/recorder-release.yml` + `recorder/build-app-ci.sh`, macos-раннер, universal arm64+x86_64, minos 13.0) и публикует как asset тега `recorder-build-<N>`; **оттуда zip обязан быть залит в Storage** — раздача идёт только из бакета. **Диагностика скачивания честная (issue #91):** 403/404 говорит «файл не опубликован», а не «нет интернета» — раньше обе ветки врали про прокси и уводили разбор не туда |
| `swarm-recorder-setup` (токен) | — | **Обновление рекордера не требует перевыпуска токена.** Если `SWARM_TOKEN` в команде нет, установщик берёт уже прописанный токен из `~/Library/Application Support/SwarmRecorder/config.json` (`plutil -extract`, штатный бинарь) — поэтому «обновить приложение» больше не ведёт через перевыпуск. Перевыпуск (`mintRecorderToken`) нужен только при потере токена, установке на ДРУГОЙ мак или утечке; он переносит прежний хэш в `allowed_users.recorder_token_prev_hash` с коротким сроком (`recorder_token_prev_expires_at`, 24 ч). `verifyAgentToken` принимает и его, а при первом успешном запросе с НОВЫМ токеном перекрытие гасится сразу — окно живёт минуты. `/revokerecordertoken` гасит оба (утечка — не место для мягкости). Мотив (issue #146): перевыпуск убивал старый токен в тот же миг, и брошенная на полпути установка оставляла рекордер писать встречи без возможности их залить — молча. ⚠️ Перекрытие — страховка, а не механизм: [Ory про graceful rotation](https://www.ory.sh/docs/hydra/guides/graceful-token-refresh) прямо предупреждает, что окно ослабляет обнаружение украденного токена, поэтому основной ответ — не требовать ротации там, где она не нужна |
| `swarm-recorder-version` | HTTP GET (публичный) | Источник истины «последний build рекордера» + **URL артефакта** для тихого авто-апдейта. Отдаёт `{build:N, url}` (url = **публичный объект Storage** `swarm_drive/recorder/SwarmRecorder-<N>.zip`). Рекордер (`Updater.swift`) при старте + не чаще раза в 6ч в простое сравнивает с вшитым `CFBundleVersion` (из `recorder/VERSION`); новее → **качает тот же zip, что и установщик, снимает карантин и переподписывает локальным cert'ом** (DR не меняется → TCC-грант жив), затем подменяет `.app` и перезапускается; во время записи не трогает (lock `.recording`). Артефакт обязан лежать на том же хосте, что и API (`Updater.assetURL` это проверяет) — сервер не может увести источник бинарника на чужой адрес. Раскатка = **залить zip сборки в Storage** (`POST /storage/v1/object/swarm_drive/recorder/SwarmRecorder-<N>.zip`, service_role, `x-upsert: true`) → поднять `LATEST_BUILD` тут (+ тег `recorder-build-<N>`). Порядок обязателен: `LATEST_BUILD` без залитого файла = раздача 404 всем. ⚠️ **Почему Storage, а не GitHub (issue #91, 2026-08-25):** репозиторий приватный с 20.08.2026 → release asset анонимно отдаёт 404, установка падала у каждого нового человека. ✅ **Апдейтер переведён на download+resign (build 23, 2026-08-25, issue #91).** До этого он клонировал тег и собирал из исходников, а на приватном репозитории это молча отказывало (`clone failed → keep current`) — авто-обновление у всей команды было мертво с 20.08.2026. ⚠️ Починка доезжает только ПЕРЕУСТАНОВКОЙ: новый механизм не может приехать по сломанному старому. Требование Command Line Tools (git/swift) у пользователей снято. Runbook — `recorder/README.md` |
| `meeting-claim` | HTTP POST (desktop-agent) | Swarm Meetings: claim/lease до транскрибации, регистрация записавших, личные пометки → приватная entry. **Арбитраж по длительности** (не «кто первый»): claim несёт `recorded_seconds`, право получает заметно более полная запись (порог ×1.5 И +5 мин), прежний владелец → `recorders[].role='superseded'`, маркеры обработки сбрасываются (транскрипт остаётся до прихода нового аудио); защищены встречи с `notes_edited_at` и `status='in_base'`; при `NULL` в `recorded_seconds` длительность держателя оценивается по `max(end)` сегментов транскрипта. Ответ: `{meeting_id, decision, lease_ttl_sec, held_by, held_by_name}` — имя держителя нужно клиенту, чтобы честно сказать «транскрибирует @кто» вместо молчания. Auth — персональный токен **Название по умолчанию (2026-08-28, #184):** запись без своего заголовка (ручной старт, звонок с нераспознанным заголовком вкладки) называется **«участник — дата»** (`_shared/meeting-title.ts` `defaultMeetingTitle`, время по Белграду) — имя берётся из `user_profiles.first_name/last_name`, иначе `allowed_users.username`, иначе «Запись». Клиентские заглушки («Запись <дата>», «Встреча», «Восстановленная запись») сняты: имя знает сервер, у рекордера на диске только токен. Человек правит заголовок вручную (`PATCH /agent-meetings/:id`). |
| `meeting-ingest` | HTTP POST (desktop-agent) | Swarm Meetings: приём **аудио** от claimer (multipart: `sys_parts`/`mic_parts` — JSON-манифест `[{name,offset}]` + файлы; рекордер **вырезает тишину перед отправкой** (`recorder/Sources/SwarmRecorder/SilenceTrimmer.swift`): энергия PCM по окнам, дорожка режется на речевые БЛОКИ по паузам ≥20с (порог −30 dBFS, паддинг 0.35с; env-override `SWARM_VAD_DB`/`SWARM_VAD_CUT`), каждый блок несёт `offset` реального старта → сервер прибавляет его к таймстампам Whisper, **порядок реплик sys/mic сохраняется** (серверную склейку НЕ трогаем). Мотив: mic-дорожка ~85% тишины (владелец слушает), Whisper тарифицируется по длительности аудио → **−~60% Whisper-минут** (замерено на реальных встречах + прогон Whisper: речь цела, галлюцинаций-«титров» МЕНЬШЕ). Пустая mic-дорожка не грузится вовсе; сбой анализа/плотная дорожка → весь файл как есть (аудио не теряем). Затем блоки режутся на части **≤25 МБ И ≤15 мин**; старый одиночный `audio`/`audio_mic` — фолбэк; принимается запись с **одной** дорожкой — только система ИЛИ только микрофон (mic-only НЕ отклоняется: юзер говорил, но через систему ничего не играло → sys-дорожка пустая). **Durable-обработка** (см. `_shared/meeting-processor.ts`): части кладутся в Storage (приватный бакет `meeting-audio`), пишется `process_state`, ставится `summary_status='processing'` + `last_progress_at`; затем короткий **inline-проход** (короткой встрече хватает — добивается сразу). Длинную добивает cron `meeting-process`. Шаг = транскрибация части (Whisper, offset; **галлюцинации на тишине** — ютуб-«титры», «продолжение следует», «спасибо за просмотр», «Крошка Антошка» и «Добро пожаловать на канал …» (встретились в двух разных записях 19.08.2026; вариант без слова «наш» раньше проходил мимо списка), мультиязычные «аутро» (валлийское «Diolch yn fawr», «感谢观看» и т.д.) — режутся чёрным списком фраз + порогом `no_speech_prob`/`avg_logprob` + **язык-независимым детектором повторов** (`isRepeatedFiller`: одна короткая фраза, повторённая по всей части, — классика тишины в любом языке); **микрофонная дорожка транскрибируется с пином языка встречи** — язык резолвится **язык-нейтральным автодетектом, взвешенным по объёму РЕАЛЬНОЙ речи** (`_shared/meeting-lang.ts` `resolveMeetingLang`): голосуют ВСЕ части (mic+sys), вес части = число символов её транскрипта, из голоса исключены части без реальной речи (галлюцинация/филлер, d.text-фолбэк, меньше `MIN_REAL_CHARS`). Побеждает язык с наибольшим объёмом речи → русская встреча остаётся русской, **английская остаётся английской** (никакого форс-ru байаса). Чанк-тишина, мис-детектнутый как английский, несёт крохи символов и не может перебить чанки, где реально говорили — так офлайн-RU с тишиной в начале резолвится RU. Если реальной речи нет вообще → `undefined` (пина нет; каждый чанк остаётся на собственном автодетекте Whisper — не форсим язык там, где пинить нечего). Пин (когда есть) — мягкий хинт Whisper, сам по себе не переводит речь. На сведении mic-часть чужого языка **НЕ отбрасывается**, а **ПЕРЕтранскрибируется с пином языка встречи** (`partsNeedingRetranscribe` — только рассинхронные части; дропать реальный транскрипт владельца хуже болезни) — это и чинит флипнутые чанки) → накопление сегментов → когда все готовы: сводка тезисов (`gpt-5.6-terra`, фолбэк `gpt-4o` при сбое модели; GPT-5 требует `max_completion_tokens` и НЕ принимает `temperature` — потому `temperature=0.3` применяется только к фолбэк-`gpt-4o`; **reasoning-токены GPT-5 списываются из того же `max_completion_tokens`** — на длинной стенограмме бюджет мог целиком уйти в reasoning → HTTP 200 c `content=""` молча записывался как готовые тезисы (инцидент 2026-07-21, `af86df08`); теперь reasoning оплачивается сверх бюджета содержимого (`GPT5_REASONING_HEADROOM`), а пустой `content` — ошибка вызова (`_shared/openai-chat.ts` `extractChatContent`, с юнит-тестами) → срабатывает фолбэк; промпт — общий канон `_shared/tezisy-prompt.ts` (`TEZISY_PROMPT` = `TEZISY_CORE` + **словарь имён собственных** `_shared/glossary.ts`: нормализует Wolt/Wolt Drive/Београд/Нови Сад/Dodo и запрещает выдумывать латиницу для незнакомых названий — Whisper мишерит бренды/топонимы фонетикой, а LLM транслитерировал их в кривую латиницу «Volt»/«Billbride»; те же имена уходят Whisper-`prompt`-хинтом; **НТАК** заведён отдельной записью, т.к. Whisper пишет его и как «Интак» — одна сущность), единый для рекордера/Granola/read-ai (DRY): требует КОНКРЕТИКИ — имена/числа/суммы/сроки/ответственные — и добавляет блок `### Решения и договорённости`, ТОЛЬКО если решения явно есть; **запрещает домысливать связи между темами** (`NO_INVENTED_LINKS_RULE`, issue #22: в стенограмме вопрос про двойные цены в Болгарии шёл вплотную к вопросу про НТАК/зап-карту, и модель выдавала «обсуждался в контексте Интака» — связи, которой не было. Правило: соседство реплик ≠ связь, «в контексте/в рамках/из-за X» — только если сказано прямо; похоже звучащие названия — разные сущности, пока не сказано обратное; на вопрос без ответа пишется «ответ в записи не прозвучал», а не достроенный из соседних реплик; при этом развести ≠ выбросить — несвязанная тема получает свой пункт со своими деталями, раздел решений сохраняется. Проверено A/B на реальном транскрипте IT+BD 12.08 — 3 прогона: ложной связки нет, детали и раздел решений на месте); **правила фактической точности** (`NO_SUBSTITUTED_NAMES_RULE`, `HEADINGS_BY_TOPIC_RULE`, `NO_FLIPPED_CLAIMS_RULE` — issue #72, разбор реальных встреч 19.08.2026): незнакомое название переносится КАК В СТЕНОГРАММЕ и не подменяется знакомым, а привязка места/участника берётся из ТОГО ЖЕ утверждения (в записи «заходили на ИСА-2» → в тезисах ошибочно «Београд 2», визит был в Нови Сад); заголовок раздела — тема, по которой будут искать через месяц, а не имя собственное из речи (разделы «### Карабач», термин «Чепляски» — нерасслышанные слова, поднятые в заголовок/термин); направление и знак утверждения не переворачиваются, а сбивчивая самоправка не выпрямляется в уверенный факт (договорились печатать информацию НА ЧЕКЕ, но не отправлять в отчёты — в тезисах вышло наоборот); **тезисы ВСЕГДА на русском** (даже англоязычная встреча → русские тезисы; стенограмма остаётся на языке встречи. Это и для ровного поиска: семантический вектор строится из тезисов, единый язык тезисов = одинаковый recall для русскоязычной команды по встречам на любом языке); **бессодержательная запись → короткая плашка вместо GPT-отписки**: `TEZIS_SYSTEM` = `TEZISY_PROMPT` + сентинел `НЕТ_ТЕЗИСОВ`, который срабатывает ТОЛЬКО на реально пустой записи (тест связи/тишина/обрывки) — содержательная встреча, даже неформальная или иноязычная, ВСЕГДА получает тезисы) + **авто-название** → `done` → уведомление → чистка Storage. Идемпотентность (`processing`/`done` → no-op) + видимость сбоя (`failed`). Auth — персональный токен. Вычитка: `swarm-api` `GET/PATCH/DELETE /agent-meetings/:id` + `POST /agent-meetings/:id/publish` (ответы `/agent-meetings` включают `recorder_names` — имена записавших, резолв `recorders[].telegram_id` → `user_profiles`) |
| `meeting-process` | Cron (каждую минуту; pg_cron `meetings-process` → `net.http_post` с `X-Cron-Secret`) | Swarm Meetings: **durable-воркер**. Берёт встречи в `summary_status='processing'` с незаконченными частями (лиз `processing_lease` — нет двойной обработки; протухший лиз перехватывается), двигает каждую на шаг в рамках бюджета (<400s wall-clock воркера) — что не успел, добьёт следующий тик. Heartbeat `last_progress_at`. Логика шага — общий `_shared/meeting-processor.ts` |
| `meeting-status` | HTTP GET (desktop-agent) | Swarm Meetings: статус встреч пачкой (`?ids=a,b,c` → `[{id, summary_status, status}]`). Рекордер держит локальный бэкап исходного аудио и удаляет его, когда встреча **опубликована в базу** (`status='in_base'`), либо по **3-суточному** потолку. `summary_status='done'` бэкап НЕ удаляет — лишь гасит капсулу «в обработке» (аудио живёт как страховка до публикации). Отдаёт статус **только встреч вызывающего** (`claim_owner`) — чужие не светит. Auth — персональный токен |
| `meeting-current` | HTTP GET (desktop-agent) | Swarm Meetings: «какая встреча идёт сейчас» для рекордера. Agent-токен (`smcp_`) → `telegram_id` → `refresh_token` из `user_integrations(service='google_calendar')` → Google Calendar API (события now±30мин) → идущее событие + идентичность для claim. Рекордеру не нужен локальный доступ к календарю |
| `meeting-heartbeat` | HTTP POST (desktop-agent) | Heartbeat рекордера: раз в ~15 мин + при старте/смене статуса записи (`recording:true/false`) пишет `allowed_users.recorder_last_{seen,recording,version}`. Читается watchdog'ом `checkRecorderHealth` (swarm-bot, из `sweepStuckMeetings`-cron) для 2 сигналов: **оборванная запись** (`recording=true` + молчит >20 мин = краш во время записи → алерт записавшему) и **истечение токена** (<7 дней → алерт `/recordertoken`). Заменил ложный Read.ai-watchdog «встречи не поступают». Auth — персональный токен |
| `google-oauth` | HTTP redirect (OAuth) | Серверная Google Calendar-интеграция для рекордера (как Granola/Read.ai). `/start` редиректит на consent Google (scope `calendar.events.readonly`), `/callback` меняет код на токены и кладёт `refresh_token` в `user_integrations(service='google_calendar')`. State — подписанный JWT с `telegram_id` (выдаёт `swarm-api` `/google/connect-url`). Секреты `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` |
| `swarm-api` | HTTP (веб-интерфейс) | REST API для веб-интерфейса «Рой» (браузер/PWA): задачи, спринты, зависимости, entries CRUD, поиск/RAG, встречи (`/meetings` + `/agent-meetings`), интеграции (Granola/Google), дайджест, фидбек, админка. Третий клиент поверх `_shared/tasks/db.ts`. Полный список эндпоинтов — в разделе [swarm-api — бэкенд веб-интерфейса](#swarm-api--бэкенд-веб-интерфейса) (канон) |

**Деплой:** `supabase functions deploy <name> --no-verify-jwt` (обязательно `--no-verify-jwt` для Telegram webhook)

---

## Общий движок задач — _shared/tasks/

Единый слой доступа к `tasks` (не деплоится как функция). Принимает готовый `group_id` и готовых исполнителей; **НЕ** резолвит имена и **НЕ** ищет workspace — это делают прослойки клиентов; бросает исключение при ошибке. Файлы: `db.ts` (CRUD), `sprints.ts`, `types.ts` (единственный источник типов задач). ⚠️ `dependencies.ts` снесён 2026-08-12 (issue #4 — мёртвый бэкенд после удаления вкладки «Граф»).

> **Канон контракта движка** (CRUD/спринты/зависимости, приватность-visibility, сведённые различия, известный остаток прямых запросов) — **[SHARED_TASKS_ENGINE.md](SHARED_TASKS_ENGINE.md)**. Здесь — только глайд клиентов поверх движка.

**Прослойки клиентов** (различия живут здесь, не в движке):

| Клиент | Файл | Что делает поверх движка |
|--------|------|--------------------------|
| swarm-mcp | `swarm-mcp/tasks/tools.ts` | резолв `requesting_user_id → group_id` (обязателен для get/delete/update); воркспейс-изоляция (`task.group_id === groupId`); fuzzy-резолв `assignee_name`; форматирование `Task[]` для Claude; `add_task` → `confirmed:false` + `created_by_telegram_id` + Telegram-уведомление создателю (`notifyCreator`) |
| swarm-bot | `swarm-bot/tasks/{db,handlers}.ts` | тонкая обёртка; **все командные листинги фильтруют `is_private=false`** — личные задачи Роя видны только в miniapp у владельца, не текут в бот; создание (wizard + `analyzeAndCreateTasks`) → `confirmed:false`+`created_by_telegram_id`, завершение wizard → `confirmed:true`+`broadcastTaskAssigned` |
| swarm-api | `swarm-api/index.ts` | HTTP-обёртка (`/tasks*`); доступ к entries — через `entries-guard.ts`; `meeting_id` валидируется (IDOR-guard) |

Прямые запросы к `tasks` мимо движка (остаток) — см. [SHARED_TASKS_ENGINE.md](SHARED_TASKS_ENGINE.md) §«Известный остаток».

### Дата, пришедшая от модели, — год не верить (`_shared/llm-date.ts`)

Промпты извлечения не знали сегодняшней даты, поэтому на день без года («заполнить таблицу
**до 17 августа**») модель дописывала год из своих обучающих данных — на проде это стабильно
давало **2023** (задача `6d2f64e5` создана 2026-08-24 со сроком `2023-08-28`; тем же образом
4 записи получили `entry_date` 2023 года при создании в мае-июне 2026). Починено 2026-08-24.

Защита в два слоя — промпт можно проигнорировать, проверку нельзя:

1. **Промпт.** Каждый промпт, из которого может выйти дата, начинается с `Сегодня <YYYY-MM-DD>`
   и несёт правило: год считать от сегодняшней даты, при дне без года брать ближайший
   подходящий, **никогда не из головы**.
2. **Нормализатор** `_shared/llm-date.ts` на границе «модель → база»:
   - `normalizeExtractedDueDate` — срок задачи, окно вменяемости **−60…+540** дней
     (назад: встречу вычитывают не в день записи, просроченный срок из тезисов нормален);
   - `normalizeExtractedEventDate` — дата события записи, окно **−400…+7** дней
     (грузят и старые документы, а встреча из будущего в базу знаний не попадает).

   Дата вне окна = год признаётся галлюцинацией: день и месяц сохраняются, год берётся
   ближайший, при котором дата попадает в окно (`2023-08-28` при сегодня `2026-08-24` →
   `2026-08-28`). Не ISO, несуществующий календарный день (`2026-02-30`) или отсутствие
   подходящего года → `null`: лучше без срока, чем с выдуманным.

**Точки применения:** `swarm-api` `gptExtractTasks`; `swarm-bot/tasks/handlers.ts`
`analyzeAndCreateTasks`; `read-ai-webhook`; `swarm-bot/lib/storage.ts`
(`buildEntryIndex`, `extractEntryMeta`); `swarm-mcp` (`extractEntryMeta` + `reindex_entry`).

⚠️ Дату, которую человек выбрал в календаре (веб-датапикер, ручной ввод в боте — там промпт
разбора уже получал `Сегодня …`), нормализатор **не трогает**: прошедший срок там осознанный
выбор, а не галлюцинация.

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
│   ├── daily-report.ts      # /report (админ) + cron daily_report_cron — чистое ядро: yesterdayWindow/aggregateActivity/formatReport
│   ├── daily-report-send.ts # sendDailyReport() — I/O поверх ядра: запрос entries + отправка ADMIN_USER_ID
│   ├── task-pings.ts            # cron task_pings_cron — ядро: isPingDue/pingRecipients/formatPings
│   ├── task-pings-send.ts       # sendTaskPings() — I/O: наступившие пинги → Telegram + notifications
│   ├── review-reminders.ts      # cron review_reminders_cron — ядро: isWorkingHours/selectDueReminders/formatReminder
│   ├── review-reminders-send.ts # sendReviewReminders() — I/O: невычитанные встречи владельца → напоминание с веб-линком
│   ├── users.ts             # /users — управление командой (allow/block)
│   ├── workspace.ts         # /workspace — управление воркспейсами (суперадмин, CLI)
│   ├── superadmin.ts        # /superadmin — интерактивная inline-панель (админы: ADMIN_USER_ID или is_admin)
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
| `workspaces` | Воркспейсы (тенанты) | `id` (TEXT PK — **постоянный опаковый слаг**, отвязан от `name`: переименование меняет только `name`, `id` НЕ трогается; в проде `id=cee`, `name="IMF BD"`. `id` = FK `group_id` во всех таблицах → смена слага = FK-миграция. Не хардкодить `group_id` в коде, юзеру показывать `name`. См. CLAUDE.md § Идентификаторы), `name` TEXT, `allowed_markets text[]` (NULL = глобальный список), `created_at` |
| `entries` | База знаний — все записи | `id`, `content`, `summary`, `embedding`, `source` (канал: `telegram`\|`granola`\|`read_ai`\|`desktop-agent`\|`link`\|`note`\|`voice`\|`file`\|…), `added_by`, `metadata` (jsonb), `countries` (включает `"General"` для общекомандных/многострановых записей), `entry_type` **CHECK `meeting`\|`note`** — два типа: встреча (транскрипт/тезисы созвона) и заметка (всё остальное). Ссылка/файл — это **фасеты заметки** через `metadata` (`url` / `file_name`+`file_type`), НЕ отдельные типы. Граница встреча↔заметка — по `entry_type`, не по source. `entry_date`, `is_private`, `owner_id`, `group_id` (FK → `workspaces.id`). Старый тип до миграции — в `metadata.legacy_entry_type` |
| `tasks` | Задачи команды + личные (Рой) | `id`, `title`, `assignees`, `due_date`, `status` (`text not null default 'open'`, **БЕЗ CHECK** — см. ниже), `tags`, `meeting_id`, `created_by`, `created_by_telegram_id`, `priority` (NULL\|`high`\|`med`\|`low`, **CHECK** `priority is null or priority in ('high','med','low')`, миграция `20260615000000`), `task_role` (NULL\|`marketing`\|`bd`\|`rnd`, **CHECK**, миграция `20260528120000`), `group_id` (FK → `workspaces.id`); модуль Рой: `is_private`, `owner_id` (FK → `allowed_users`), `start_date`, `timeline_position`, `sprint_id` (FK → `sprints`), `recur_freq` (NULL\|`daily`\|`weekly`\|`monthly` — цикличность, **CHECK**, миграция `20260827120000`; NULL = обычная задача), `recur_anchor_dom` (`smallint`, **CHECK** 1–31 — исходное число месяца для `monthly`, чтобы после зажатия коротким месяцем вернуться к нему: 31 янв → 28 фев → **31** мар), `label_ids uuid[]` (персональные смарт-метки — членство в личных списках; только на личных задачах владельца; миграция `20260716120000`, GIN-индекс), `project_id` (FK → `projects.id`, **ON DELETE SET NULL** — удаление проекта освобождает задачу, не удаляет), `project_linked` (boolean, `not null default false` — Project Space: `true` = в дереве проекта, `false` = в бэклоге; требует непустого `project_id`, миграция `20260801120000`), `parent_id` (FK → `tasks.id`, **ON DELETE SET NULL** — родитель-задача для подзадачи; NULL = ребёнок корня-проекта или бэклог; цикл-защита + каскад отвязки поддерева в `swarm-api`), `tree_x`/`tree_y` (double precision, nullable — ручная позиция узла в дереве react-flow; NULL = сид d3). `parent_id`+`tree_*` — миграция `20260806120000`. **Пинг** (ручное напоминание, миграция `20260826090000`): `remind_date` (date — день напоминания, независим от `due_date`), `reminded_at` (timestamptz — момент отправки; NOT NULL = пинг сгорел, повторно не шлётся), `remind_set_by` (bigint — кто поставил: получатель у общей задачи без исполнителя). Частичный индекс `idx_tasks_pending_ping` держит выборку крона маленькой (`remind_date is not null and reminded_at is null`). ⚠️ `created_by_name` — **НЕ колонка**: вычисляется в слое `swarm-api` (`GET /tasks`) из `created_by_telegram_id` через `creatorMap` |
| `sprints` | Спринты (Рой) | `id`, `group_id` (FK → `workspaces.id`), `name`, `start_date`, `end_date`, `status` (`planned`\|`active`\|`completed`), CHECK `start_date<=end_date` |
| `projects` | Проекты (Рой) — **теперь = пользовательские секции доски «Спринт»** (`SprintBoard.tsx`, владелец создаёт «+ Секция» → `createProject`), с **вложенными подпроектами** (ровно 2 уровня, добавлено 2026-08-07). Задача в секции/подпроекте через `tasks.project_id`, колонка через `tasks.status` (`backlog`/`open`/`in_progress`/`done`) | `id` (uuid PK), `group_id` (FK → `workspaces.id`), `name`, `color`, `emoji`, `created_by` (bigint, telegram_id, nullable), `created_at`, **`sprint_id`** (FK → `sprints.id`, **ON DELETE SET NULL** — вкладка-владелец: проект принадлежит одной вкладке доски «Проекты»; переключение вкладки показывает её проекты; подпроект наследует вкладку родителя; удаление вкладки не удаляет проект, а выводит из неё; миграция `20260809120000`; существующие проекты перенесены в вкладку «Гарро»; **вкладки** (`sprints`) остаются общими на воркспейс — приватности НЕТ у вкладок, но она есть у самих проектов, см. ниже), **`parent_id`** (FK → `projects.id`, **ON DELETE SET NULL**, self-ссылка; `null` = верхний уровень — обычная секция или группа; заполнено = подпроект; индекс `idx_projects_parent`; миграция `20260807120000`), **`is_private`** (boolean, `not null default false`, миграция `20260819120000` — тумблер приватности, **с 2026-08-24 работает и на проекте, и на подпроекте**: скрывает строку от остальной команды, видит только `created_by` (админского обхода нет). Закрытие проекта наследуется вниз — его подпроекты закрываются вместе с ним; закрытие подпроекта на группу и соседей не влияет. UI — тумблер `PrivacyToggle` в заголовке проекта И подпроекта (`SprintBoard.tsx` → `toggleProjectPrivacy` → `PATCH /projects/:id {is_private}`); закрытая строка подписана словами «Только я»/«Only me», у подпроекта закрытой группы вместо кнопки — метка «Закрыт вместе с проектом»).

**Модель приватности (переписана 2026-08-24, issue #86 — доска стала ОБЩИМ пространством):** проект и подпроект по умолчанию видны всей команде воркспейса; прячет только тумблер `is_private`, и он **наследуется вниз по дереву** — закрытый проект закрывает все свои подпроекты, закрытый подпроект закрывается один. Закрытая строка видна/мутируема только своему `created_by` — админского обхода нет с 2026-08-21 (решение владельца: оверсайт есть у ЗАДАЧ, у проектов нет; см. decisions/2026-08-21-admin-visibility.md); `created_by === null` (легаси/системная строка) НЕ прячется ни от кого. Подпроект внутри чужой закрытой группы закрыт даже для того, кто создал сам подпроект (закрыта вся ветка). Предикат живёт в ОДНОМ месте — `canViewProject(row, viewerId, index)` в `_shared/tasks/project-access.ts` (сведено 2026-08-20, issue #37; там же `isProjectPrivate()`, `parentLookup()` — индекс `id → строка` для обхода вверх, и `pickProjectByName()` — чистый резолв имени в id для MCP). **Счётчики `task_count`/`backlog_count`** на карточке проекта считаются с той же видимостью ЗАДАЧ, что применяет `listTasks`, — **включая админский оверсайт** (`listProjects(groupId, { viewerId, isAdmin })`, 2026-08-25): у админа фильтр приватности задач снимается, иначе цифра на карточке противоречит доске под ней (проверено на проде: подпроект показывал «0 задач» при 11 видимых). Доступ к самим проектам это не меняет — `canViewProject` про админа по-прежнему не знает. **Вызывающий обязан передать индекс ВСЕХ строк воркспейса**: без родителя приватность подпроекта не вычислить, и предикат честно схлопывается в fail-closed (строка не видна) вместо того, чтобы показать лишнее. До 2026-08-24 приватным считался любой подпроект (`parent_id !== null`, правило от 2026-08-07/08-19), из-за чего рабочие подпроекты не видел никто, кроме автора, а флаг `is_private` на подпроекте не работал вовсе — канон нового поведения: decisions/2026-08-24-subproject-visibility.md. Его зовут `listProjects` (видимость в `GET /projects`), `canMutateProject` (право править/удалять в `PATCH`/`DELETE /projects/:id`) и `matchProject` в `swarm-mcp/tasks/tools.ts`. **Новый читатель таблицы `projects` обязан звать `canViewProject`, а не писать своё условие** — до сведения правило было переписано руками трижды и в MCP отсутствовало вовсе. ⚠️ **Известные незакрытые зазоры** (issue #38): приватность проекта НЕ каскадируется на его задачи (`listTasks` фильтрует только `task.is_private`, не привязанный проект — публичная задача приватного проекта продолжает течь в `GET /tasks`); пока строка открыта, тумблер `is_private` может выставить любой участник воркспейса (не только `created_by`), включая случайную/чужую руку — согласуется с тем, что rename/delete публичного проекта тоже открыты всем (решение 2026-07-01), но стоит отдельного решения владельца; `canMutateProject` — check-then-act без блокировки строки (узкое TOCTOU-окно, тот же класс гонки, что чинили для глубины вложенности триггером `trg_projects_depth`, issue #13). ✅ issue #37 закрыт 2026-08-20: `matchProject` теперь выбирает `parent_id`/`is_private`/`created_by` и отсекает невидимые строки ДО поиска по имени, поэтому чужой приватный проект не резолвится ни точным именем, ни частичным и не создаёт ложную неоднозначность (13 тестов, включая проверку «отказ неотличим от „проекта нет“»). Админского обхода в MCP нет вовсе (снят 2026-08-21) — чужой приватный проект не резолвится ни у кого. Ровно 2 уровня — гарантирует `validateParent()` в `_shared/tasks/projects.ts` (родитель должен сам быть верхнего уровня; проект с детьми нельзя сделать чьим-то подпроектом; без self-parent), вызывается из `createProject`/`updateProject` при указании `parent_id`, нарушение → `Error` → 400 в `swarm-api`. **Плюс DB-гард** — триггер `trg_projects_depth` (`projects_enforce_depth()`, миграция `20260812140000`, issue #13): та же проверка на уровне БД с `FOR SHARE`-блокировкой строки родителя → закрывает TOCTOU-гонку конкурентных правок, которую код-валидация пропускала. **Рендер (`SprintBoard.tsx`):** проект верхнего уровня без подпроектов = обычная секция (один канбан, как раньше); проект верхнего уровня С подпроектами = рамка-группа с заголовком, внутри — отдельный канбан (4 колонки) на каждый подпроект + ряд **«Общее»/«General»** для задач, привязанных прямо к группе (`tasks.project_id` = id группы). Удаление проекта — `deleteProject()`: FK `ON DELETE SET NULL` обнуляет `project_id` у задач + сброс `project_linked=false`; удаление **группы** дополнительно поднимает её подпроекты на верхний уровень (тот же `ON DELETE SET NULL` на `projects.parent_id`) — подпроекты не удаляются и не теряют задачи. Миграция `20260801120000` (базовая таблица). ⚠️ Поля `tasks.parent_id`/`tree_x`/`tree_y` (миграция `20260806120000`, **другая таблица** — `tasks`, не `projects`, тёзка по имени колонки) относились к отключённой вкладке-дереву «Проекты» — **паркованы**, в текущем UI (секции) не используются |
| ~~`task_dependencies`~~ | **СНЕСЕНА 2026-08-12** (issue #4) — таблица + RPC `get_all_dependencies` дропнуты (миграция `20260812130000`), эндпоинты `/dependencies*` и `_shared/tasks/dependencies.ts` удалены. Была: зависимости задач для вкладки «Граф» (удалена при замене на «Проекты») |
| `task_history` | История изменений задач | `id`, `task_id` (FK → `tasks`, ON DELETE CASCADE), `changed_by`, `old_status`, `new_status`, `note`, `created_at` |
| `task_labels` | Персональные смарт-метки (личные списки) задач | `id`, `owner_id` (**NOT NULL**, FK → `allowed_users.telegram_id` — метка всегда чья-то личная), `group_id` (FK → `workspaces.id`, зарезервирован под будущие общие списки), `name`, `icon` (имя из набора RoyIcon, дефолт `tag`), `color`, `sort_order`, `created_at`. Членство хранится в `tasks.label_ids`. Миграция `20260716120000` |
| `meetings` | Swarm Meetings — источник истины о встрече (НЕ путать с `entries`) | `id`, `source` (`desktop-agent`), `identity_kind` (**CHECK** `identity_kind in ('calendar','room','manual')`)/`identity_key` (дедуп; UNIQUE кроме manual), `transcript` (jsonb), `draft_notes_md` (черновик тезисов до публикации), `notes_edited_at`, `entry_id` (FK → `entries`, при публикации), `recorders` (jsonb — кто записал: `[{telegram_id, claimed_at, role, recorded_seconds}]`, `role` = `transcribe`\|`defer`\|`superseded`), `attendees` (jsonb `[{name,email}]` — участники из календаря, собраны рекордером при claim; при публикации несутся в `entry.metadata.attendees`, показываются компонентом `Participants` (`roy/ui.tsx`) — чип «Участники (N)» в одну строку, список раскрывается выпадашкой-порталом. Аудио-диаризации нет — кто говорил, не различаем; для ручных записей без события пусто), `claim_owner`/`lease_expires_at` (право транскрибации), `recorded_seconds` (double precision — длительность записи текущего `claim_owner`; основа арбитража «побеждает более полная запись», миграция `20260817120000`; `NULL` = строка от старой сборки, длительность оценивается по транскрипту), `status` (`awaiting_review`\|`in_base` — публикация), `summary_status` (`processing`\|`done`\|`failed` — фоновая транскрибация+тезисы, отдельно от `status`), `mic_start_offset` (double precision — сдвиг старта mic-дорожки относительно system в секундах, может быть <0; миграция `20260624120000` ✅ применена), `process_state` (jsonb — durable-обработка: манифест частей в Storage + накопленные сегменты + стадия `transcribe`/`summarize`), `last_progress_at` (timestamptz — heartbeat: watchdog валит в `failed` только по застою), `processing_lease` (timestamptz — лиз durable-воркера; миграция `20260626120000`), `group_id` (FK → `workspaces.id`). Личные пометки участников — отдельные приватные `entries` с `metadata.meeting_id` |
| `sessions` | Состояние диалога бота | `chat_id` (PK), `action`, `context` (jsonb), `updated_at` (TTL 30 мин) |
| `allowed_users` | Белый список | `telegram_id` (nullable — email-only/pending), `username`, `email` (**каноничный ключ веб-входа Google Sign-In**, уникальный индекс по `lower(email)`), `is_admin`, `group_id` (FK → `workspaces.id`); токены (см. [MCP-аутентификация](#mcp-аутентификация)): `claude_mcp_token_hash`, `claude_mcp_token_expires_at` (MCP/Claude Desktop, бессрочный → `null`), `recorder_token_hash`, `recorder_token_expires_at` (отдельный токен рекордера, миграция `20260617120000`); heartbeat-мониторинг рекордера: `recorder_last_seen`, `recorder_last_recording`, `recorder_last_version`, `recorder_expiry_warned` (миграция `20260708120000`) |
| `user_profiles` | Профили пользователей | `telegram_id`, `first_name`, `last_name`, `role` (**CHECK** `role in ('marketing','bd','rnd')`, миграция `20260528120000`), `markets`, `phone`, `email`, `notes`, `name_aliases`. ⚠️ **`username` здесь НЕТ** — он в `allowed_users`. Имя = `first_name`+`last_name`, фолбэк на `@username` из `allowed_users` (хелпер `resolveNames` в swarm-api). Не селектить `username` из `user_profiles` — PostgREST упадёт на несуществующей колонке → `data=null` |
| `user_integrations` | API-ключи интеграций | `telegram_id`, `service` (`granola`), `api_key`, `last_polled_at`, `skipped_note_ids` |
| `app_settings` | Глобальные настройки | `key`, `value` — `feedback_channel_id`, `granola_last_polled_at`, `deploy_notice` (см. §app_settings — ключи) |
| `oauth_tokens` | OAuth токены интеграций | `service` (`read_ai`), `client_id`, `access_token`, `refresh_token`, `expires_at`, `updated_at` |
| `oauth_state` | Временный PKCE state для OAuth | `state`, `client_id`, `code_verifier` — создаётся при старте OAuth, удаляется после callback |
| `task_comments` | Комментарии-апдейты к задаче (веб + MCP) | `task_id` (FK → `tasks`, ON DELETE CASCADE, индекс `idx_task_comments_task_id`), `content`, `added_by_telegram_id` (bigint; имя резолвится на чтении), `added_by` (legacy, nullable), `created_at` |
| `task_subscriptions` | Подписка на уведомления о комментариях к задаче (issue #82) — таблица **ИСКЛЮЧЕНИЙ**, а не всего круга: нет строки = поведение по умолчанию (причастные получают, остальные нет) | `task_id` (FK → `tasks`, ON DELETE CASCADE, индекс `idx_task_subscriptions_task`), `telegram_id` (FK → `allowed_users`, ON DELETE CASCADE), PK = (`task_id`,`telegram_id`), `state` (**CHECK** `subscribed`\|`muted`), `reason` (**CHECK** `comment`\|`manual` — откуда взялась строка, нужно для пометки в пуше), `created_at`, `updated_at`. Миграция `20260824180000`. RLS включён, политик нет (внешний замок) |
| `notifications` | Лента колокольчика: событие «к твоей задаче написали» на КАЖДОГО получателя (миграция `20260824120000`) | `recipient_telegram_id` (FK → `allowed_users`, CASCADE), `group_id`, `type` (`check`: `task_comment` \| `task_reminder` — второй добавлен миграцией `20260826090000` под пинги задач; у него `actor_telegram_id` = NULL, событие системное), `task_id`/`comment_id` (FK, ON DELETE CASCADE — уведомление уходит вместе со своим поводом), `actor_telegram_id`, `read_at` (null = непрочитано), `created_at`. Индексы: `idx_notifications_recipient` (лента), `idx_notifications_unread` (частичный, счётчик бейджа) |

### `tasks.status` — значения и целостность

⚠️ **`tasks.status` НЕ ограничен CHECK на уровне БД** (`text not null default 'open'`, `supabase/migrations/00000000_initial_schema.sql`; ни одна миграция CHECK не добавляет). БД примет **любую строку** — целостность держится только на прикладном слое. CHECK на `status` есть лишь у `sprints` (`planned`/`active`/`completed`) и `meetings` (`awaiting_review`/`in_base`), но НЕ у `tasks`.

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

**Миграции — единственный источник схемы.** Всё живёт в `supabase/migrations/`: базовые таблицы создаёт `00000000_initial_schema.sql`, остальные файлы (по дате) накатываются поверх. Контур с нуля поднимается одной командой — `supabase db reset` (проверено на пустой базе 27.08.2026, 60 миграций). Рукописный дубль схемы `supabase/schema/00_base_schema.sql` **удалён 27.08.2026** (issue #118): он дважды отставал от миграций — не хватало колонок пинга задач и цикличности — и обещал bootstrap, который на деле давал неполную таблицу `tasks`. ⚠️ Версия миграции = префикс имени файла, и Supabase CLI держит по ней PK: **два файла с одним номером роняют `supabase db reset`** (issue #120, прожило три дня) — коллизию ловит гард в `.githooks/pre-commit`. Инкрементальные файлы в основном только `ALTER` существующие таблицы, **но не все**: таблица `meetings` (Swarm Meetings) **создаётся** миграцией `20260612000000_meetings.sql` (`CREATE TABLE`, additive). ⚠️ `00_base_schema.sql` может отставать от migrations — например, на момент ревизии в нём нет `tasks.priority`, токенов рекордера и таблицы `meetings` (они добавлены поздними миграциями).

---

## Флоу сохранения записей (entries)

Всё проходит через `saveEntry()` в `lib/storage.ts` (исключение: granola.ts делает прямой insert, но с той же логикой индексирования).

### Роутинг входящего текста: сохранить vs искать (детерминированно)

**Гейт групповых чатов (шаг 0, до всего остального).** В группе/супергруппе бот реагирует только на явное обращение: команду (`/cmd`, `/cmd@этот_бот`) или `@упоминание` бота в тексте (упоминание вырезается перед роутингом). Болтовня, любые медиа (голос/фото/файлы) и чужие `/cmd@другой_бот` молча игнорируются — иначе каждое сообщение в группе (напр. группе фидбека) трактовалось бы как запрос к базе. Личка не затронута. Логика — `swarm-bot/lib/group-gate.ts` (`gateGroupMessage`, + тесты), username бота — `getBotUsername()` в `lib/telegram.ts` (getMe, кэш на инстанс); гейт стоит в `index.ts` ДО `checkAllowedWithGroup`, так что посторонним в группе бот и «Доступ запрещён» не пишет. Callback-кнопки (напр. `fb_read_` в группе фидбека) гейт не трогает.

Решение «сохранить или искать» НЕ отдаётся LLM (раньше отдавалось → бот непредсказуемо то сохранял, то искал один и тот же тип сообщения). Порядок в `index.ts` (ветка `if (!isCommand)`), сверху вниз:

1. Активные сессии (`manage_replace`, `waiting_add`, `waiting_ask`, `sa_*`, meeting/user/task/granola/feedback) — их вход.
2. `classifyEntryCommand` (удали/замени запись) → `handleEntryCommand`.
3. Голый URL <300 символов → `handleUrl`.
4. **Пересланное сообщение** (`forward_origin`/`forward_date`/`forward_from`/`forward_from_chat` в `TgMessage`) → **`handleAdd` (сохранить сразу + тезисы)**. Самый надёжный сигнал «это контент». Не доходит до GPT.
5. **Явное создание задачи** — `parseCreateTaskCommand` (`intent.ts`): `<добавь/создай/заведи/поставь/запланируй> [мне|себе|<имя>] задач(у)[:] …` → `handleQuickCreateTask` (создаёт активную задачу `confirmed:true`; исполнитель по имени через `findUserByMention` или сам отправитель, при чужом — уведомление). Проверяется ПЕРЕД сохранением. Пустой заголовок → пропуск (мастер `/addtask`). Отделяет создание от поиска («какие у меня задачи?» → `handleAsk`).
6. **Явная команда сохранения** — `parseSaveCommand` (`intent.ts`): `сохрани/запомни/занеси/запиши/внеси[:] …` или `<глагол> … в базу/знания/хранилище/рой/сворм/swarm/улей[:] …` → `handleAdd`. «добавь» без destination и без слова «задачу» сюда НЕ входит.
7. Иначе текст ≥3 символов → `handleAsk` (вопрос/поиск). Агент сохранять **не умеет**, кроме `save_private` (только явное «в личное»).

**Recency-вопросы** («что только что/последнее сохранил», «что нового в базе» по времени) обслуживает инструмент `list_recent` (сортировка по `created_at`), а НЕ `search_knowledge` — семантика ранжирует по смыслу и вернула бы старую нерелевантную запись.

### Типы источников (`source`)
| source | Откуда | Как индексируется |
|--------|--------|-------------------|
| `telegram` | Текст ≥300 символов через /add | `buildEntryIndex` (1 GPT вызов): summary + страны + тип + keywords |
| `note` | Текст <300 символов через /add | GPT keyword-enrichment в `handleAdd`, General тег автоматически |
| `link` | URL с описанием | GPT расширение описания в `media.ts`, затем `saveEntry` |
| `voice` | Голосовое | Whisper (`verbose_json`) → фильтр галлюцинаций (`_shared/whisper-hallucinations.ts`, общий со встречами) → `saveEntry` (summary через `buildEntryIndex`); пустой результат (тишина/мусор) не сохраняется |
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
      промпт начинается с "Сегодня <YYYY-MM-DD>", entry_date прогоняется через
      normalizeExtractedEventDate (_shared/llm-date.ts) — год от модели не верим
  → General tag (applyGeneralSentinel, _shared/meta-extract.ts — единый для swarm-bot/swarm-api/read-ai):
      РОВНО 1 рынок → тег; 0 ИЛИ >= 2 рынка (кросс-маркет/HQ/1:1) → РОВНО ["General"] (СХЛОПЫВАЕМ, НЕ список+General:
      иначе запись всплывала в выдаче/дайджесте КАЖДОЙ перечисленной страны — баг перетега, чинён 2026-07-31;
      порог 3→2 — решение владельца 2026-08-06, двойные теги тоже схлопываются, см.
      docs/superpowers/specs/2026-08-06-country-attribution-consolidated.md)
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
  → для каждой новой заметки (дедуп по granola_note_id + skipped, окно 48ч, ≤10/прогон;
      + кросс-источниковый дедуп перед insert — см. §Дедуп встреч):
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

### Дедуп встреч — кросс-источниковый (`_shared/meeting-dedup.ts`)
Точечные механизмы ловят дубли только ВНУТРИ одного источника: `granola_note_id` + `skipped_note_ids` (Granola), `meetings.identity_key` + race-guard `entry_id` (рекордер), retry самого Read.ai. Они НЕ видят: (а) **мульти-участничьи** дубли Granola — у каждого участника свой `note_id`, но это одна встреча; (б) **кросс-источниковые** — та же встреча из Granola и рекордера. Поверх них — общий слой `findDuplicateMeeting()`.

**Правило дубля** (калибровано на prod-данных, уклон в точность — лучше пропустить дубль, чем проглотить новую встречу). Два уровня:

1. **Гейт по `identity_key`** (сильнейший сигнал). `meetings.identity_key` = календарное событие + день; при публикации рекордера несётся в `entry.metadata.identity_key`. Если ключ есть у **обеих** сторон — решает однозначно: **равны → дубль** (та же встреча, напр. записана двумя рекордерами), **различаются → РАЗНЫЕ встречи, склеивать нельзя** (даже при полностью идентичном составе участников). Именно отсутствия этого гейта хватило, чтобы схлопнуть 4 разные встречи IMF BD 23.07 в одну запись `da4cef3f`: у записей рекордера в `content` нет строки «Дата: …, HH:MM» → время кандидата не парсится → гейт по времени (п.2) отваливался → дедуп склеивал по одному лишь пересечению состава (у регулярных командных созвонов он идентичен).
2. **Эвристика** (fallback, когда ключа нет хотя бы у одной стороны — Granola/Read.ai/старые записи без `metadata.identity_key`): та же `entry_date` + СИЛЬНОЕ пересечение участников (≥2 человек И ≥ половины меньшего списка) + время в пределах **±5 мин** (если известно у обоих). Сильное пересечение нужно, потому что разные встречи могут делить 1–2 общих человек (реальный отсечённый ложный дубль: 1-1 «Maria/Aleksandra» 08:00 ⨯ большая «CVM IMF» 08:15 — общий только один). Настоящие дубли Granola несут идентичный состав (один календарный инвайт) и тот же `scheduled_start_time` (Δ=0). Точный хэш набора участников НЕ годится — у разных участников списки различаются, нужен overlap. Кандидаты берутся по `entry_date` (индекс `idx_entries_date`); время и участники парсятся из `content` («Дата: …, HH:MM» + «Участники: …») и из `metadata.attendees`.

**Где применяется** (перед каждым созданием записи-встречи):
| Точка | Файл | Поведение на дубле |
|---|---|---|
| Granola авто-импорт | `granola.ts` `ingestNewGranolaNotesForUser` | skip + `markSkipped` (не плодим в очереди ревью) |
| Granola ручное сохранение | `granola.ts` `saveGranolaNote` | сообщение «уже в базе» + `markSkipped` |
| Granola веб-импорт | `swarm-api` `POST /granola/notes/:id/import` | mark skipped + `200 {duplicate}` (уходит из очереди) |
| Рекордер публикация | `swarm-api` `POST /agent-meetings/:id/publish` | привязать `meeting` к существующей записи + вернуть её (только если она видима публикующему — публичная/его личная; чужие приватные игнорируем) |
| Read.ai вебхук | `read-ai-webhook` | skip ДО дорогих LLM-вызовов и `extractAndSaveTasks` (иначе задачи-сироты) |

🔒 **Приватность фильтруется ВНУТРИ `findDuplicateMeeting` (параметр `viewerId`), а не вызывающим** (issue #45, 2026-08-20). Раньше функция возвращала чужую ЛИЧНУЮ встречу с флагами и полагалась на фильтр каждого потребителя — из четырёх фильтровал один: заголовок уходил в Telegram (`granola.ts`), `id`/`title` отдавались наружу (`swarm-api`), а входящая встреча из Read.ai **молча выбрасывалась** как «дубль» невидимой записи (потеря данных). Без `viewerId` (вебхук — конкретного зрителя нет) отбрасываются ВСЕ приватные кандидаты, fail-closed: дубль общей встречи виден и убирается руками, потерянная встреча — нет.

Тесты — `_shared/meeting-dedup.test.ts` (включая регрессию на тот самый ложный дубль и на `identity_key`-гейт: разные ключи одного дня с идентичным составом → НЕ дубль, кейс IMF BD 23.07). Накопленные ДО внедрения дубли (7 пар) уже объединены без потери данных — 0 осталось (детали в BACKLOG).

### Тезисы — AI-редактирование (✏️ Тезисы / ✏️ Переписать)
- **До сохранения (preview):** `gedit_` → сессия `granola_edit_preview_<noteId>` → инструкция → GPT переписывает → сессия восстанавливается в `granola_preview_<noteId>` → можно итерировать
- **После сохранения (/meetings):** `medit_` → сессия `meeting_edit_summary_<entryId>` → инструкция → GPT переписывает, читая `entries.content` + `entries.summary`

### swarm-api: PATCH /meetings и preview-извлечение задач (для desktop-ревью встреч)
- `PATCH /meetings/:id` принимает (помимо `confirmed`/`summary`/`countries`): `content` (правка текста), `is_private` (+ `owner_id` задаётся/снимается как у задач), `entry_type` (реклассификация «встреча → заметка», уводит запись из очереди `GET /meetings`).
- `POST /tasks/extract { text, save:false }` — возвращает предложенные задачи БЕЗ создания (preview). Без `save:false` (по умолчанию) — старое поведение: создаёт задачи и возвращает их.
- **Потоковый режим — по заголовку `Accept: text/event-stream`**, не отдельным путём: контракт эндпоинта не меняется, старый JSON-ответ продолжает работать для всех, кто про поток не знает. Сервер отдаёт SSE, по одному JSON на `data:`: `{"type":"task","task":{…}}` на каждую дописанную моделью задачу, затем `{"type":"done","count":N}`; обрыв — `{"type":"error","message":…}` (молча не глотаем: пустой разбор и сорванный разбор — разные вещи). **`error` шлётся и в случае «модель что-то написала, а задач вышло ноль»** — это признак сломанного разбора, а не пустой встречи, и показывать его как «Задач не найдено» значило бы отдать неверный ответ с уверенным лицом. Промпт и тело запроса общие для обоих режимов (`extractPrompt`/`extractRequestBody`), нарезка ответа модели на объекты — `_shared/json-object-stream.ts` (+ `.test.ts`), разбор самого протокола SSE — `_shared/openai-sse.ts` (+ `.test.ts`, фикстура реальных кадров chat/completions: этот кусок нельзя проверить без ключа OpenAI, поэтому он вынесен отдельно и закрыт тестами). **Зачем:** замер прод-логов — обычный вызов swarm-api 200–600 мс, а извлечение 2.9/3.2/5.3 с, и это целиком генерация модели; поток показывает первую задачу примерно через секунду вместо пяти.
- Срок в предложенных задачах прогоняется через `normalizeExtractedDueDate` (`_shared/llm-date.ts`) ещё до показа в preview — год, выдуманный моделью, до экрана не доходит.
- **Строковые «пустоты» от модели гасятся двумя слоями** (issue #125): промпт `gptExtractTasks` требует JSON-литерал `null` без кавычек, а `cleanExtractedField` в том же файле дополнительно превращает `"null"`/`"none"`/`"-"`/`"n/a"` в настоящий `null` и выбрасывает задачи без заголовка. Промпт можно проигнорировать, проверку — нет: до этого строка `"null"` доезжала до карточки разбора серым чипом «null» вместо страны. Тот же список продублирован на клиенте (`miniapp/src/lib/proposedTasks.ts`, там же тесты) — он страхует уже любой кривой ответ API.
- **Автогенерации задач при публикации встречи НЕТ** (убрана 2026-06-29). Задачи создаёт только пользователь кнопкой «Сгенерировать» (компонент `TasksFromMeeting`, есть и в ревью-очереди `MeetAdminScreen`, и на экране встречи `MeetingDetail`): preview → **разбор в листе `TasksHarvestSheet`** (2026-08-27: чекбоксы «взять», инлайн-правка заголовка, одна кнопка «Добавить N задач» на все выбранные — раньше каждую задачу приходилось открывать в `TaskModal` по отдельности) → создание. Добавленные задачи идут через `POST /tasks` с `meeting_id = entry.id`, поэтому видны в блоке «Задачи из встречи» (фильтр `task.meeting_id === entry.id`). Исполнителя клиент считает перед созданием одним хелпером `effectiveAssigneeId` (`lib/proposedTasks.ts`): имя, извлечённое моделью, резолвится в `telegram_id` (`resolveAssigneeId`), **а если подтянуть не удалось по ЛЮБОЙ причине — имя не названо, названо не из команды, названо неоднозначно — задача уходит на того, кто её сгенерировал** (решение владельца 2026-08-28, канон [decisions/2026-08-28-assignee-falls-back-to-author.md](decisions/2026-08-28-assignee-falls-back-to-author.md); перекрывает прежнее «не нашёлся → без исполнителя» из issue #126, поводом был инцидент #151 — две задачи легли ничьими и без срока, то есть невидимо для автора). Ничья задача остаётся только если личность разбирающего неизвестна. Тот же хелпер считает исполнителя в строке разбора, поэтому человек видит будущего исполнителя ДО публикации (а при подмене — исходное имя из тезисов рядом); тост дописывает «· N без исполнителя», если ничьи задачи всё же уехали. Подробности поверхности — `MINIAPP_ARCHITECTURE.md`.

### Swarm Meetings (desktop-agent) — рекордер (задеплоено на прод)
Замена Read.ai/Granola: лёгкий **свой** macOS-рекордер (Swift/ScreenCaptureKit, **без форка anarlog**) пишет аудио онлайн-звонков и шлёт в Swarm Brain; **транскрибация и тезисы — в облаке (OpenAI)**, без локальной модели. Полный дизайн — `transcribator/10-REVISED-DESIGN.md`.
```
Все участники записывают аудио → meeting-claim (на СТОПЕ записи, до загрузки):
  транскрибирует ОДИН — тот, чья запись ПОЛНЕЕ (арбитраж по recorded_seconds), остальные defer;
  lease с TTL 30 мин (свободную встречу без транскрипта перехватывает любой);
  каждый регистрируется в meetings.recorders; его пометки → приватная entry (metadata.meeting_id)
  ⚠️ ПОЧЕМУ НЕ «кто первый»: claim подаётся на СТОПЕ, поэтому «первый заявившийся» = тот, кто
  раньше нажал стоп = владелец САМОЙ КОРОТКОЙ записи. Инцидент 17.08.2026 (issues #23/#24):
  коллега остановила запись на 3-й минуте при переходе в другой Google Meet и забрала право;
  полная запись на 2ч26м пришла через 2.5 часа, получила defer и была УДАЛЕНА клиентом —
  в базе осталось 3 минуты орг-возни вместо всей встречи. Теперь:
   • claim несёт recorded_seconds; заметно более полная запись ПЕРЕХВАТЫВАЕТ право
     (порог: ×1.5 И +5 мин разом — близкие по длине записи не гоняют перетранскрибацию);
     у строк старых сборок (recorded_seconds=NULL) длительность оценивается по max(end)
     сегментов сохранённого транскрипта → перехват работает и против старого клиента;
   • перехват НЕ трогает встречу, которую правил человек (notes_edited_at) или уже
     опубликовали команде (status='in_base'); прежний владелец → recorders[].role='superseded';
   • сбрасываются ТОЛЬКО маркеры обработки (summary_status/process_state/…): старый транскрипт
     остаётся до прихода нового аудио — не заливка не опустошает встречу;
   • decision=defer НЕ удаляет аудио (было: removeItem) — запись едет в карантин
     failed/<meetingId>/ под общий 3-суточный потолок + пользователь получает уведомление
     «твоя запись не пошла в обработку, транскрибирует @кто» и пункт меню «Дослать мою запись»
     (перезаявка с длительностью → при отказе остаётся в карантине, итог всегда озвучен).
     Смоук спасательного пути: SwarmRecorder --selftest-quarantine (живой прогон перезаявки —
     с SWARM_SELFTEST_URL/SWARM_SELFTEST_TOKEN/SWARM_SELFTEST_KEY).
claimer → meeting-ingest: грузит АУДИО (части ≤15мин → Storage) → durable-обработка по куску
  (inline-проход в ingest + cron meeting-process, переживает wall-clock) → meetings.transcript
  → async GPT-тезисы → meetings.draft_notes_md (общий черновик, НЕ в базе знаний/поиске)
  → уведомление записавшим «готово к вычитке»
  локальный бэкап аудио в рекордере НЕ удаляется на 202 — живёт до ПУБЛИКАЦИИ в базу
  (status='in_base', опрос meeting-status) или до 3-суточного потолка (UploadQueue, build 3);
  защита от потери при сбое обработки/тезисов и до момента, пока встреча реально не в базе
вычитка (PATCH /agent-meetings/:id) + аппрув (POST /agent-meetings/:id/publish):
  создаётся entries (выбор базы: воркспейс/личное), эмбеддинг, status=in_base.
  Один объект → из «на вычитке» уходит у всех разом
```
**Живые пометки на полях (Granola-режим, нативная панель рекордера).** Во время записи рекордер показывает **единое окно** `LiveNotesPanel` (Swift/AppKit, `recorder/Sources/SwarmRecorder/LiveNotesPanel.swift`): один морф-объект — компактная пилюля-шапка (контролы: марка-toggle · REC+таймер · полоски уровня я/собеседники · ✕ стоп · **редактируемое название встречи**) ⇄ развёрнутый блокнот (та же шапка + лента пометок). Клик по марке (жопка шмеля) морфит высоту. Отдельного виджета во время записи нет (`syncWidget` прячет `RecorderWidget`). Пользователь пишет пометки по ходу — они копятся в локальный буфер с таймстампом-офсетом (meetingId появляется только на стопе при claim); **название встречи правится на ходу** и переопределяет дефолт (календарь/«Запись …») — уходит в `meetings.title` через `title` в claim ([meeting-claim](#)). На стопе: claim создаёт meeting → `flush()` меняет рекордер-токен на короткоживущий **web-JWT** через edge-fn `meeting-webtoken` (HS256 `{telegram_id}`, секрет `WEB_JWT_SECRET`) → POST каждой пометки `Bearer`-ом в `swarm-api` `POST /agent-meetings/:id/notes` → строки в таблице `meeting_live_notes` (`meeting_id`, `offset_sec`, `text`, `owner_id`; миграция `20260628120000`). Веб-экран `/live` рендерит то же (демо без параметра / реальная встреча по `?m=<id>`). **На вычитке пометки видны** секцией «Пометки на полях» (offset + текст, `fetchAgentMeetingNotes` → `GET /agent-meetings/:id/notes`) в обоих экранах ревью — `MeetAdminScreen` и `MeetingReview` (реализовано 2026-07-23). Дальнейшее (опционально) — переплести пометки с транскриптом/тезисами по времени единой лентой.

**Эндпоинты swarm-api (вызывает веб-интерфейс, auth — сессия роя):** `GET /agent-meetings?status=` (очередь вычитки/опубликованные; видны ТОЛЬКО записавшим — у админа оверсайта нет, см. §Приватность), `GET /agent-meetings/:id` (черновик + транскрипт), `PATCH /agent-meetings/:id` (правка `draft_notes_md` → `notes_edited_at`), `POST /agent-meetings/:id/publish` (`{base: workspace|personal, countries?}` → создать entries, привязать, идемпотентно), `GET /agent-meetings/:id/market-suggestion` (подсказка рынков для чипов на вычитке), `GET/POST /agent-meetings/:id/notes` (живые пометки: список / добавление в `meeting_live_notes`, auth — web-JWT от `meeting-webtoken`).

Дедуп нескольких записавших — по `meetings.identity_key` (calendar/room; manual без дедупа, дубли — ручным «объединить»); при публикации поверх работает кросс-источниковый дедуп (§Дедуп встреч) — если встреча уже в базе (напр. из Granola), `meeting` привязывается к существующей записи, а не плодит вторую. Аутентификация агента — персональный токен (`_shared/agent-auth.ts`, личность из токена, не из payload). Фильтры источников включают `desktop-agent` (swarm-api `GET /meetings`, MCP `get_meetings`, бот `rai_saved`).

**Веб (miniapp):** `MeetingReview` — страница вычитки одной встречи (тезисы редактируются, транскрипт под спойлером, участники, публикация с выбором базы команда/личное); `AgentReviewQueue` — очередь «на вычитке» в разделе Встречи (невидима без черновиков). Deep-link из уведомления: `?meeting=<id>` (браузер) / `startapp=meeting_<id>` (спящий Mini App-deeplink) → `getDeepLinkMeetingId()` в `lib/telegram.ts` открывает вычитку. **Дедуп вкладок/окон** (Telegram Desktop открывает ссылку новой вкладкой каждый раз): `lib/single-tab.ts` + `SingleTabGate` (в `layout.tsx`) — новая вкладка с `?meeting=` через `BroadcastChannel` + `navigator.locks` (лидер `swarm-leader`) отдаёт встречу уже открытой вкладке и закрывается; установленный PWA через `launch_handler: focus-existing` + `handle_links` в манифесте ловит ссылку в существующее окно (`window.launchQueue`). Обе ветки → событие `roy:open-meeting` → `openMeeting(id)` в `RoyApp`. Спек: `docs/superpowers/specs/2026-06-17-single-tab-reuse-design.md`.

**Статус:** **задеплоено на прод** (`vbqglndbxkpmreccpqmr`) — таблица `meetings` (через `apply_migration`: `supabase db push` нельзя, история миграций дрифтит — локальные файлы и remote-записи расходятся по таймстампам) + функции `meeting-claim`/`meeting-ingest`/`swarm-api`/`swarm-mcp`/`swarm-bot`. Smoke-тест auth зелёный (нет/невалидный токен → 401). Осталось: ~~`WEB_BASE_URL`~~ ✅ выставлен (`https://swarm-brain.pages.dev`) — в уведомлении «тезисы готовы» теперь есть кнопка «Открыть» на `/?meeting=<id>`; веб-страница уезжает на прод через Cloudflare Pages (зависит от ветки CF — push в `sandbox_vas` сделан); полный e2e с реальным `smcp_`-токеном; экстракция задач при публикации **убрана** (2026-06-29): задачи больше не генерятся автоматически — только по кнопке «Сгенерировать задачи» (`TasksFromMeeting`, preview → добавить, привязка `meeting_id = entry.id`); агент — **свой лёгкий рекордер** (Swift/ScreenCaptureKit) — **написан** (`recorder/`, собирается `swift build -c release`): двухдорожечный захват, `UploadQueue` (персист+ретрай, защита от потери записи), silence-watchdog, jitter/Retry-After, живой уровень звука. **Установка одной командой из бота:** `/recordertoken` → `curl … | bash` (edge-fn `swarm-recorder-setup` + `recorder/setup-signing.sh` для стабильного TCC; клон `--branch main`). Задеплоено: `swarm-recorder-setup`, `swarm-bot`, `meeting-claim`, `meeting-ingest`, `meeting-process`. **Durable-обработка длинных встреч** ✅: аудио-части в Storage (`meeting-audio`), cron `meeting-process` (каждую минуту) транскрибирует по куску и переживает wall-clock воркера; рекордер режет дорожки ≤15 мин; watchdog валит в `failed` только по застою `last_progress_at` (миграция `20260626120000`: `process_state`/`last_progress_at`/`processing_lease`). Миграция `mic_start_offset` (`20260624120000`) ✅ применена. Авто-стоп рекордера по концу созвона (тишина системной дорожки) ✅. Транскрибация/тезисы — облако OpenAI. Остаётся: e2e-приёмка реального длинного звонка после реинстала рекордера.

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
| `feedback_category` | feedback.ts | Ожидание выбора раздела (клавиатура `fbcat_`) |
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
| `mc_<entryId>` | Подтвердить встречу. **Жёсткий блок**: если `entries.countries` пусто — не публикует, просит проставить рынки (кнопка `mctry_`) |
| `mctry_<entryId>` | Открыть пикер **рынков** встречи (мультивыбор → `entries.countries`, фильтр до `workspaces.allowed_markets`) |
| `mctog_<entryId>_<code>` | Переключить рынок (ISO-код или `General`) в наборе `entries.countries`; перерисовывает пикер |
| `mctry_done_<entryId>` | Закрыть пикер: пересчитать embedding под новые страны + кнопка «Подтвердить встречу» |
| `medit_<entryId>` | Редактировать тезисы (AI) |
| `mrename_<entryId>` | Переименовать встречу |
| `mtr_<entryId>` | Скачать транскрипт |
| `mtag_<meetingId>` | **🏷 Темы** — свободный текст → `metadata.tags` (НЕ типизированные страны; рынки — через `mctry_`) |
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

> `/help` (`handlers/help.ts` `getHelpText()`) — обзор возможностей + мысль «одна общая база, три двери: бот / веб / Claude» + блок «Как подключить» с **inline-кнопкой** «⚙️ Настроить систему» (`helpKeyboard()`, callback `guide_open`). Веб **Swarm Brain** — HTML-ссылка, команды Telegram делает тапабельными сам.

### Настройка системы (мастер, саморедактируемое сообщение)
Строится в `handlers/help.ts` (`guideMenu()`, `guideStep(1|2|3)`); диспатч — в `index.ts` (callback-блок). Порядок шагов строго: Claude Desktop (MCP) → рекордер → Google-авторизация.
| Код | Действие |
|----|---------|
| `guide_open` | Из-под справки: прислать НОВОЕ сообщение-меню мастера (`sendInlineMessage`) |
| `guide_menu` | Перерисовать текущее сообщение обратно в меню («← К шагам», `editInlineMessage`) |
| `guide_s1` / `guide_s2` / `guide_s3` | Перерисовать текущее сообщение в детали шага (Claude / рекордер / Google) |

> Google-авторизация (шаг 3) делается только в вебе (Swarm Brain → Настройки → Google-календарь) — команды бота нет; мастер это явно проговаривает.

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
| `fbcat_<category>` | Выбор раздела фидбека (recorder/meetings/search/… — канон `_shared/feedback-categories.ts`) → шаг скриншота |
| `fb_done` | Пропустить скриншот, сохранить фидбек без фото |
| `fb_read_<feedbackId>` | **Legacy** (в новых постах канала кнопки нет): помечает фидбек `status='read'` (раньше — удалял из БД; разрушающий delete убран) |

### MCP/рекордер-токен — подтверждение перевыпуска (`/mytoken`, `/setup`, `/recordertoken`)
| Код | Действие |
|----|---------|
| `mtk_reissue` | Подтвердить перевыпуск MCP-токена (`/mytoken`), когда живой уже есть |
| `setup_reissue` | Подтвердить переподключение Claude Desktop (`/setup`), когда токен уже активен |
| `rtk_reissue` | Подтвердить перевыпуск токена рекордера (`/recordertoken`), когда живой уже есть |

_Все три: перевыпуск **убивает старый токен**, поэтому без явного подтверждения молчаливый минт рвал бы рабочий config.json/коннектор. Обработка — `swarm-bot/index.ts`; см. §MCP-аутентификация._

---

## Таблица feedback

| Колонка | Тип | Описание |
|---------|-----|---------|
| `id` | uuid PK | |
| `telegram_id` | bigint | Кто отправил |
| `username` | text | Telegram username |
| `text` | text NOT NULL | Текст фидбека |
| `photo_file_id` | text | Telegram file_id (legacy; канон скрина — `screenshot_url`) |
| `screenshot_url` | text | Durable URL скрина в `swarm_drive` (виден вне Telegram) |
| `status` | text | `new` → `triaged` → `done` / `wontfix` (дефолт `new`) |
| `category` | text | Раздел (дефолт `other`); канон enum — `_shared/feedback-categories.ts` |
| `source` | text | `bot` / `web` (дефолт `bot`) |
| `task_id` | uuid | Линк на задачу, если фидбек в неё превращён |
| `resolved_at` | timestamptz | Когда закрыт (done/wontfix) |
| `created_at` | timestamptz | |

**Модель:** persistent inbox — фидбек НЕ удаляется при прочтении, копится со статусом. Разбор — через MCP (`get_feedback`/`resolve_feedback`, владелец-only) или SQL. Канал `app_settings.feedback_channel_id` — пассивный пинг (текст + скрин, без кнопок); если не задан — фидбек только в БД. Чистка — cron `feedback_retention_cron` (закрытое старше 90 дней + скрины).

Формат сообщения в канале: `[BOT_NAME] 🐛 @username · дата\n\nтекст`. Имя бота берётся из env-переменной `BOT_NAME` (по умолчанию `"bot"`). Позволяет использовать одну общую группу для нескольких ботов.

---

## Контроль доступа

- `checkAllowed(userId)` в `lib/storage.ts` — проверка белого списка
- `checkAllowedWithGroup(userId)` в `lib/workspace.ts` — проверка белого списка + возвращает `group_id` пользователя одним запросом
- `visibilityFilter(userId)` — строка фильтра для запросов: `is_private=false OR (is_private=true AND owner_id=userId)`
- **Админ** = `telegram_id === ADMIN_USER_ID` (зашитый суперадмин-разработчик, `lib/supabase.ts`, fail-safe) **ЛИБО** `allowed_users.is_admin=true` (напр. руководитель). Единый признак: swarm-api считает `isAdmin` в резолве пользователя (`index.ts`, флаг тянется из `allowed_users`), бот — хелпер `isAdminUser()` (`lib/supabase.ts`). Админ управляет воркспейсами/пользователями (`/admin/*`) и имеет **оверсайт по ЗАДАЧАМ**: видит и правит чужие, включая личные (`canViewTask`/`canMutateTask`, счётчики проектов) — ⛔ **осознанное решение владельца, не снимать без явного «да»**, канон и причина в [decisions/2026-08-21-admin-visibility.md](decisions/2026-08-21-admin-visibility.md); точка входа в UI — тумблер «Все сотрудники» на доске задач, по умолчанию выключен. На **записи, встречи и проекты оверсайт НЕ распространяется**: там обхода нет вовсе (записи/встречи — 2026-08-07, проекты и подпроекты — 2026-08-21, `isAdmin` убран из `canViewProject`). Помни, что «админ» — это и флаг `allowed_users.is_admin`, а он стоит больше чем у одного человека. Защита самого суперадмина от удаления привязана к зашитому `ADMIN_USER_ID`.
  - 🔒 **Несогласованная встреча видна только причастным** (issue #66, 2026-08-22): в очереди вычитки (`GET /meetings?confirmed=false`) действует не обычный фильтр «не приватная → видна всем», а `buildReviewQueueQuery` — **владелец записи ИЛИ участник встречи** (матч по e-mail в `metadata.attendees` ↔ `allowed_users.email`; на проде сматчилось 27 встреч из 27, у которых участники заполнены). Причина: `read-ai-webhook` создаёт запись без `is_private` и без `owner_id`, дефолт колонки даёт «общая и ничья» — такая встреча висела в очереди у ВСЕГО воркспейса, и согласовать её мог человек, которого на встрече не было. Решение владельца: «если встреча была общая — показывать на вычитке всем участникам, сохранит тот, кто успеет».
- 🔒 **«Ничьих» записей быть не должно** (решение владельца 2026-08-22). При согласовании `owner_id` больше НЕ обнуляется: `is_private` отвечает за видимость, `owner_id` — за авторство. Раньше ДВА места (`confirmed:true` и `is_private:false`) явно ставили `owner_id = null`, отсюда в базе 159 встреч без хозяина. Теперь владелец = автор записи, а если он неизвестен (Read.ai пишет без владельца) — тот, кто согласовал.
  - 🔒 **Правило приватности ЗАДАЧ — ОДИН гард `_shared/tasks/access.ts`** (`canViewTask`/`canMutateTask`/`taskAccessError`), его зовут swarm-api, swarm-api/task-comments и swarm-mcp (update/delete/комментарии). Рукописных копий больше нет — раньше их было шесть, и они разошлись: `swarm-mcp` проверял только воркспейс, поэтому любой участник **правил и удалял чужую личную задачу** (issue #45, закрыто 2026-08-20). **Отказ неотличим от «не найдена»** — иначе перебор `id` подтверждает существование чужой личной задачи. Оверсайт по задачам действует и в swarm-api, и в MCP (единый гард `access.ts`); на проекты он не распространяется.
  - 🔒 **Приватные ЗАПИСИ/ВСТРЕЧИ (`entries`) — БЕЗ admin-байпаса** (решение владельца 2026-08-07): личная запись/встреча (`is_private=true`) видна ТОЛЬКО владельцу, даже админу/руководителю. Действует везде: `getEntrySecure`/`buildEntriesQuery` (нет `isAdmin`), `GET /meetings` (прежний admin-override `?all` убран), `GET /search` (`matchEntries` по `requesting_user_id`), дайджест (privacy-фильтр; `all_countries` снимает только фильтр рынков), MCP `get_meetings`/`get_storage_stats`. Исключение из строгости — только задачи (выше). Не-`is_private` рекордер-черновики (`agent-meetings`, таблица `meetings` без приватности) остаются в админ-очереди ревью `?all` — это не личное.
- Все запросы через `SERVICE_ROLE_KEY` — RLS не работает, фильтрация только в коде
- 🔒 **RLS включён на всех 18 таблицах `public`, политик НЕТ — deny-all для `anon`/`authenticated`** (миграция `20260819180000_rls_enable_remaining.sql`, issue #41). Это НЕ авторизация (её делает код, выше), а замок на прямой доступ к базе в обход Edge Functions: anon-ключ Supabase публичен по дизайну, и до фикса пять таблиц (`meetings`, `meeting_live_notes`, `projects`, `sprints`, `task_labels`) стояли без RLS — реальные встречи читались анонимно через `/rest/v1` (проверено на проде до и после: было `[{id,title},…]`, стало `[]`, запись → 401). Приложение и cron не задеты: `service_role` и `postgres` — `rolbypassrls=true`. **Следствие:** клиент не может ходить в базу напрямую (supabase-js в браузере упрётся в deny-all); понадобится — сперва политики, потом код
- Workspace-изоляция: все запросы к `entries` и `tasks` фильтруются по `group_id` пользователя — пользователь видит только данные своего воркспейса
- **Demo-сессия** (`telegram_id === DEMO_USER_ID` 900000001, вход по секретной ссылке `/api/auth/demo?key=<DEMO_ACCESS_KEY>`): барьер `isDemo` в `swarm-api` форсит `group_id='demo'` (НЕ из БД), `isAdmin=false`, 403 на токен-минт. Admin-роуты недоступны (они НЕ group-scoped — broadcast шлёт всем, workspaces/:id/users по любому id — были бы дырами). Данные изолированы тем же `group_id`-фильтром, что `cee`↔`other`. Наполнение — `supabase/demo-seed.sql` (идемпотентный ресет к эталону)

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

Команды доступны админам (`ADMIN_USER_ID` или `allowed_users.is_admin=true`, через `isAdminUser()`). Логика — в `handlers/workspace.ts`, CRUD-операции — в `lib/workspace.ts`.

---

## MCP-аутентификация

Персональные токены вместо `requesting_user_id` на доверии.

**Механизм:**
- `allowed_users.claude_mcp_token_hash TEXT` — sha256(token) в hex; plaintext никогда не хранится
- `allowed_users.claude_mcp_token_expires_at timestamptz` — срок жизни токена. **MCP-токен бессрочный**: `mintMcpToken` пишет `null`, а `swarm-mcp`/`agent-auth` трактуют `null` как «без срока» (проверка `expires_at && expires_at < now()` короткозамыкается). Колонка остаётся для рекордера и на случай возврата TTL
- `allowed_users.recorder_token_hash`/`recorder_token_expires_at` — **отдельный токен рекордера** (`/recordertoken`, 365 дней), независимый от MCP-токена: перевыпуск `/mytoken` в Claude Desktop не ломает рекордер. `agent-auth` (meeting-claim/ingest) принимает claude_mcp_token_hash **ИЛИ** recorder_token_hash. Минт/статус токена — общий модуль `_shared/recorder-token.ts` (бот `/recordertoken` и веб `Настройки → Рекордер` = тонкие двери над ним)
- Claude Desktop / коннектор claude.ai отправляет `Authorization: Bearer smcp_<uuid>` с каждым запросом
- Минт/статус MCP-токена — общий модуль `_shared/mcp-token.ts` (бот `/setup`,`/mytoken` и веб `Настройки → Claude Desktop` = тонкие двери над ним; `swarm-bot/lib/mcp-setup.ts` — обёртки на bot-клиенте)
- `swarm-mcp/index.ts` — токен **разбирается** сразу после тела запроса, но контроль доступа применяется **точечно к `tools/call`**, НЕ к хендшейку:
  1. sha256(token) → lookup по `claude_mcp_token_hash` → `verifiedTelegramId`; если токен передан, но не найден/протух → запоминается `tokenError` (без раннего отказа)
  2. **Протокольные методы (`initialize` / `tools/list` / `notifications/initialized`) отвечают ВСЕГДА**, независимо от токена — иначе устаревший/неверный Bearer в коннекторе claude.ai роняет весь хендшейк (`-32001` на `initialize`) и коннектор молча «отваливается» целиком (подтверждено репродукцией офиц. MCP SDK: `connect()` падал на `-32001`; fix 2026-07-01). Раскрываются только имена/описания инструментов — не данные
  3. На `tools/call`: `tokenError` → отказ с подсказкой (`Invalid token`/`Token expired — run /mytoken`); в strict-режиме без валидного токена → отказ; иначе `verifiedTelegramId` инжектируется в `args.requesting_user_id` (значение из тела игнорируется)
  4. `MCP_AUTH_REQUIRED=true` → строгий режим (без валидного токена `tools/call` — отказ; хендшейк по-прежнему проходит)
- Выдача: `/setup` в боте (минтит токен + даёт команду авто-установки, см. `swarm-setup`), `/mytoken` (голый токен — для ручного config.json ИЛИ веб-коннектора) или `SELECT generate_mcp_token(<telegram_id>)` в SQL Editor (сессия под `postgres`; **EXECUTE у этой функции только у `service_role` — anon/authenticated закрыты миграцией `20260826210000`**, иначе публичный anon-ключ выпускал токен на любого; advisory GHSA-vxrp-599j-46hv). Plaintext единожды. Логика минта — общий хелпер `swarm-bot/lib/mcp-setup.ts` (`mintMcpToken`)
- **Два пути подключения** (инструкция для пользователя — `/connect_claude`): **(A) Claude Desktop на Mac** — `/setup` ставит мост `mcp-remote` + пишет `config.json` (только stdio-форма); **(B) claude.ai в браузере** — `/mytoken` даёт голый токен, пользователь вставляет вручную в Settings → Connectors (URL `swarm-mcp` + Bearer). Оба шлют тот же `Authorization: Bearer smcp_…`
- ⚠️ **Ни `/setup`, ни `/mytoken`, ни `/recordertoken` НЕ перевыпускают токен молча.** Перевыпуск **убивает старый токен** (`mintMcpToken` перезаписывает hash → прежний мгновенно мёртв). Если живой токен уже есть (`hasActiveMcpToken`/`hasActiveRecorderToken`), бот предупреждает и просит подтверждения кнопкой: `mtk_reissue` (/mytoken), `setup_reissue` (/setup), `rtk_reissue` (рекордер) — callbacks в `swarm-bot/index.ts`. Молчаливый минт — **только при первом подключении** (активного токена ещё нет). До fix 2026-07-06 `/setup` минтил безусловно → повторный `/setup` рвал рабочий config.json/коннектор — это была частая причина жалоб «токен протух»
- 🔍 **«Токен протух» / `Invalid token` почти всегда = рассинхрон, НЕ истечение.** MCP-токен бессрочный (`expires_at=null`) — по времени не умирает. Ошибка значит: клиент (config.json Desktop или Bearer в коннекторе claude.ai) шлёт СТАРЫЙ токен, которого уже нет в БД. Диагностика: `SELECT claude_mcp_token_hash IS NOT NULL AS has, claude_mcp_token_expires_at FROM allowed_users WHERE telegram_id=<id>` — если `has=true` и `expires_at=null`, токен в БД жив → чинить КЛИЕНТА. Починка: `/mytoken` → «Всё равно перевыпустить» → свежий токен → обновить в коннекторе; или `/setup` (Mac) → переустановит config
- Отзыв: `/revoketoken` в боте или `SELECT revoke_mcp_token(<telegram_id>)` в SQL Editor (гасит хэш + срок; EXECUTE тоже только `service_role`, см. `generate_mcp_token` выше)
- ⚠️ В `claude_desktop_config.json` использовать только stdio-форму (`command`+`mcp-remote`); поле `url`/`type:http` Claude Desktop молча затирает весь `mcpServers` (anthropics/claude-code#37286)

**Доступ при выходе коннектора в орг-список Claude:**
Орг-список управляет только видимостью коннектора, не доступом к данным. Шлюз — токен:
- В soft-режиме (`MCP_AUTH_REQUIRED` не выставлен) `requesting_user_id` берётся из аргументов **на доверии** → любой член орга читает всё. **✅ В проде `MCP_AUTH_REQUIRED=true` выставлен (2026-07-19) — soft-режим ВЫКЛЮЧЕН.**
- В strict-режиме доступ есть только у владельцев валидного `smcp_`-токена; нежелательные члены орга получают `401`. Даже владелец токена видит лишь свой `group_id` и свои приватные записи.

Ошибка при невалидном/отсутствующем токене: JSON-RPC -32001 — возвращается **на `tools/call`**, а не на хендшейке (коннектор при этом остаётся подключённым, инструменты видны).

---

## Переменные окружения

Канонический список — таблица ниже. Покрывает Supabase Edge Functions (секреты `supabase secrets set`), Cloudflare Pages Functions (`miniapp/functions/*`, задаются в дашборде CF) и сборочные `NEXT_PUBLIC_*` веб-интерфейса. Потребители выверены `grep` по `Deno.env.get(...)` / `env.*` / `NEXT_PUBLIC_*`.

### Supabase Edge Functions (секреты)

| Переменная | Где используется (функции) | Обязательная | Назначение |
|-----------|---------------------------|-------------|-----------|
| `SUPABASE_URL` | все функции (через `_shared`) | да | URL проекта Supabase для клиента |
| `SUPABASE_SERVICE_ROLE_KEY` | все функции (через `_shared`) | да | Service-role ключ; RLS обходится, фильтрация в коде |
| `OPENAI_API_KEY` | swarm-bot, swarm-mcp, swarm-api, meeting-claim, meeting-ingest, meeting-process, read-ai-webhook | да | OpenAI: chat (GPT-4o-mini), embeddings, Whisper-транскрибация |
| `TELEGRAM_BOT_TOKEN` | swarm-bot, swarm-api, swarm-mcp, meeting-ingest, meeting-process, read-ai-webhook, granola-poller (legacy) | да | Telegram Bot API: отправка сообщений/уведомлений; проверка подписи Login Widget (веб) и спящей Mini App initData (swarm-api) |
| `BOT_NAME` | swarm-bot (feedback) | нет, дефолт `"bot"` | Префикс `[BOT_NAME]` в пересланном фидбеке (одна группа на несколько ботов) |
| `MCP_AUTH_REQUIRED` | swarm-mcp | нет | `true` = жёсткий режим (без валидного `smcp_`-токена — отказ); не выставлен = soft-режим на доверии. **В проде выставлен `true` (2026-07-19)** |
| `CRON_SECRET` | swarm-bot, meeting-process, granola-poller (legacy) | нет | Общий секрет для авторизации cron-вызовов (`X-Cron-Secret`): Granola-поллинг/watchdog (swarm-bot), durable-обработка встреч (meeting-process) |
| `INITDATA_MAX_AGE` | swarm-api | нет, дефолт 24ч | TTL свежести `auth_date` в Telegram Mini App initData (секунды). ⚠️ Спящий путь — вход как Mini App отключён |
| `MINIAPP_ORIGIN` | swarm-api | нет | Разрешённый Origin для CORS веб-интерфейса. Он же — база ссылки «Открыть задачу» в пуше о комментарии (`?task=<id>`, см. `swarm-api/notifications.ts`): не задан или `*` → пуш уходит без ссылки |
| `WEB_JWT_SECRET` | swarm-api, google-oauth | да (для веб-режима/Google) | HS256-секрет: проверка `Bearer`-JWT браузерной сессии (swarm-api) и подписанного OAuth-state (google-oauth `/google/connect-url`). Должен совпадать с CF Pages |
| `WEB_BASE_URL` | google-oauth, meeting-ingest, meeting-process | да (для deep-link/OAuth-redirect) | База веб-фронта (`https://swarm-brain.pages.dev`): кнопка «Открыть» `?meeting=<id>` в уведомлении (meeting-process/ingest), redirect после Google OAuth (google-oauth) |
| `GOOGLE_CLIENT_ID` | google-oauth, meeting-current | да (для Google Calendar рекордера) | OAuth client id серверной Google Calendar-интеграции |
| `GOOGLE_CLIENT_SECRET` | google-oauth, meeting-current | да (для Google Calendar рекордера) | OAuth client secret той же интеграции (обмен кода / рефреш токена) |
| `GOOGLE_CLIENT_EMAIL` | swarm-bot (`lib/drive.ts`) | нет (для Google Drive) | Service-account email: JWT-issuer для Google Drive (загрузка файлов) |
| `GOOGLE_PRIVATE_KEY` | swarm-bot (`lib/drive.ts`) | нет (для Google Drive) | Приватный ключ того же service-account (подпись JWT; `\n` разэкранируются) |
| `GOOGLE_DRIVE_FOLDER_ID` | swarm-bot (`lib/drive.ts`) | нет (для Google Drive) | Корневая папка Drive для авто-создаваемых подпапок/файлов |
| `READ_AI_CLIENT_ID` | read-ai-auth | да (для Read.ai OAuth) | OAuth client id Read.ai (авторизация в `read-ai-auth`) |
| `READ_AI_WEBHOOK_SECRET` | read-ai-webhook | да (для Read.ai webhook) | Секрет проверки входящего вебхука Read.ai |
| `READ_AI_ENABLED` | read-ai-webhook | нет (дефолт выкл.) | Kill-switch обработки Read.ai-вебхука: только `="true"` включает приём (иначе 200 OK без записи в БД — Read.ai не ретраит) |

> Примечание: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (OAuth-интеграция календаря рекордера) и `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_DRIVE_FOLDER_ID` (service-account для Google Drive) — **разные** механизмы Google, не путать.

### Cloudflare Pages Functions (`miniapp/functions/*`, дашборд CF)

| Переменная | Где используется | Обязательная | Назначение |
|-----------|----------------|-------------|-----------|
| `SWARM_API_URL` | `api/[[path]].ts` | да | Целевой URL swarm-api для прокси-форварда (`/api/*` → swarm-api) |
| `WEB_JWT_SECRET` | `api/auth/telegram.ts`, `_lib/jwt.ts` | да | HS256-секрет выдачи/проверки браузерного JWT (тот же, что в Supabase) |
| `TELEGRAM_BOT_TOKEN` | `api/auth/telegram.ts` | да | Проверка подписи Telegram Login Widget (тот же, что в Supabase) |

### Веб-интерфейс build-time (`NEXT_PUBLIC_*`)

| Переменная | Значение | Назначение |
|-----------|---------|-----------|
| `NEXT_PUBLIC_API_URL` | `/api` (прокси) или прямой URL swarm-api | База API; `/api` → same-origin прокси через CF Pages Function (вариант B+) |
| `NEXT_PUBLIC_BOT_USERNAME` | напр. `swarm_brain_bot` (без `@`) | Username бота для Telegram Login Widget |
| `NEXT_PUBLIC_DEV_MODE` | `true` / `false` | `true` — мок-данные без бэкенда (локальная разработка UI) |

---

## swarm-api — бэкенд веб-интерфейса

```
supabase/functions/swarm-api/
├── index.ts        # Router + все эндпоинты
├── auth.ts         # verifyInitData() — проверка Telegram initData (спящий путь Mini App) + проверка веб-JWT
├── admin.ts        # /admin/* роуты (админы: telegram_id 744230399 или is_admin)
├── entries-guard.ts  # Обязательный слой безопасности для всех endpoints с entries + ENTRY_COLUMNS
└── meetings-payload.ts # Урезание СПИСОЧНОГО ответа GET /meetings (toListRow)
```

**Назначение:** REST API для веб-интерфейса «Рой» (браузер/PWA). Третий клиент поверх `_shared/tasks/db.ts`.

**🚫 `select("*")` по `entries` запрещён — только `ENTRY_COLUMNS`** (issue #102). У таблицы есть `embedding vector(1536)` (~18.5 кБ текстом на строку) и `fts tsvector` (~7.8 кБ), которых нет ни в `EntryRow`, ни в клиентском `Entry`. Сервер их только **пишет** (пересчитывает через OpenAI / генерирует база) и ни в одной точке не читает — в ответе это чистый балласт: 6 МБ из 10 на списке встреч и 26 кБ на каждое открытие одной записи. Закреплено двумя тестами: `entries-guard.test.ts` («getEntrySecure запрашивает ENTRY_COLUMNS, а не `*`») и детектором дрифта `no-star-select.test.ts`, который сканирует исходники swarm-api и падает на любом новом `select("*")` по `entries` — обычный юнит-тест это правило не держит, точек доступа много и новая появляется одной строкой. Детектор помнит последнюю `from("…")` в цепочке: `.insert({…})` бывает разорван на десяток строк, и проверка «в пределах трёх строк» пропускала такие случаи (проверено — пропустила две).

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

**Аутентификация (три способа входа, все резолвятся в `telegram_id`):**

1. **Telegram Mini App — ⚠️ СПЯЩИЙ (вход отключён)** — `Authorization: tma <initData>`. Код проверки остался, но точки входа нет: Mini App выключен ~2026-07-15 (коммит `53bd3ae`, бот ведёт на PWA). Живой путь — только браузерный JWT (п.2). На удаление — см. `docs/BACKLOG.md`.
   - Проверка подписи: `secret_key = HMAC("WebAppData", BOT_TOKEN)`, `hash = HMAC(secret_key, data-check-string)`
   - Свежесть `auth_date` (дефолт 24ч, `INITDATA_MAX_AGE`)
   - `telegram_id` из `user` в initData
2. **Браузер (веб, R-5 вариант B+)** — `Authorization: Bearer <JWT>` (HS256, `WEB_JWT_SECRET`)
   - JWT выдаёт CF Pages Function `/api/auth/telegram` после проверки подписи Login Widget, кладёт в httpOnly-cookie `roj_session` (**30 дней, скользящее окно** — см. ниже)
   - Прокси `/api/[[path]].ts` перекладывает cookie → `Bearer` при форварде в swarm-api (httpOnly недоступен JS и не уходит cross-origin)
   - Выход/смена аккаунта: `POST /api/auth/logout` гасит cookie (`Max-Age=0`) → редирект на `/login`. Кнопка в Настройках (`AccountSection`), показывается только в браузерной сессии (`!getInitData()`)
   - Кнопка Telegram на `/login` — своя (не iframe-виджет), через `Telegram.Login.auth` (bot_id) → редирект на тот же `/api/auth/telegram`. Вторичный способ; основной — Google (п.3).
3. **Браузер — Google Sign-In (ОСНОВНОЙ, 2026-07-29)** — кнопка «Sign in with Google» на `/login`.
   - CF Pages `/api/auth/google/{start,callback}` (переиспользует OAuth-приложение календаря; `GOOGLE_CLIENT_ID/SECRET` в CF-env, нормализуются от случайного `http://`): scope `openid email profile`, `hd=dodobrands.io` + **серверная сверка домена** verified email = `dodobrands.io`. state — HMAC(next) на `WEB_JWT_SECRET`.
   - Резолв verified email → личность: Supabase `auth-resolve` (авторизация вызова — HMAC на `WEB_JWT_SECRET`, `SERVICE_ROLE` в CF не тащим) по **`allowed_users.email`** → `telegram_id` → та же `roj_session` cookie (30 дней, скользящее окно), что и п.2.
   - **Имя из Google заполняет профиль (2026-08-28).** userinfo отдаёт `given_name`/`family_name` (scope `profile` запрашивался и раньше — имя просто выбрасывалось), они идут в `auth-resolve` тем же запросом и дозаполняют **пустые** `user_profiles.first_name`/`last_name`; заполненное руками не перетирается. Нужно как источник дефолтного названия записи без календаря (#184) — до этого `first_name` не писал автоматически никто.
     **Подпись вызова:** канон строки — `email|given|family` (`_shared/google-profile.ts` `nameSigPayload`, зеркало для Pages — `miniapp/functions/_lib/google-name.ts`, эквивалентность закреплена тестом `miniapp/src/lib/googleName.test.ts`). Имя принимается ТОЛЬКО с этой подписью — иначе владелец подписи голого email подменил бы чужое имя реплеем. **Голая подпись `HMAC(email)` остаётся валидной** (без имени): Pages и функции раскатываются не атомарно, и жёсткая смена контракта уронила бы вход на время между двумя деплоями.
   - **Продление сессии (скользящее окно, issue #50):** срок один на все точки выдачи — `SESSION_TTL_SEC` в `miniapp/functions/_lib/jwt.ts` (**30 дней**; копия константы в `supabase/functions/_shared/jwt.ts` — обе правятся вместе). Прокси `/api/*` (`miniapp/functions/api/[[path]].ts`) при каждом запросе с валидной cookie старше `SESSION_REFRESH_AFTER_SEC` (сутки) переиздаёт её с новым `exp` → активный пользователь не разлогинивается никогда, брошенная сессия истекает через 30 дней после ПОСЛЕДНЕГО запроса. Переиздания нет, если апстрим ответил 401/403, подпись битая или срок вышел. `iat` в payload нет — момент выдачи считается как `exp - TTL`, поэтому старые 7-дневные токены переезжают на новое окно при первом же запросе, а не обрываются. До 2026-08-20 продления не было вовсе: сессия жила 7 дней от входа, и человек, работавший каждый день, всё равно вылетал раз в неделю.
   - Whitelist по email ведёт админ: `allowed_users.email` — **каноничный ключ входа** (синк из карточки профиля `PATCH /admin/users/:ref` + приём `email` в `addUserToWorkspace`; `user_profiles.email` — зеркало). Нет email в whitelist → `?err=not_allowed`.
   - **Email-only (без Telegram) РАБОТАЕТ** (issue #21, коммит `ee56ff7`): строка `allowed_users` с email и `telegram_id=NULL` — это ОЖИДАЮЩЕЕ приглашение; при первом Google-входе `auth-resolve` атомарно присваивает ей **синтетическую идентичность `telegram_id = -id`** (реальные Telegram id положительные → коллизий нет) и заводит минимальный профиль (имя = локальная часть email). Дальше вся система работает с ней как с обычным юзером.
   - **Почту ожидающему приглашению задаёт админ через `PATCH /admin/users/:ref`**, где `ref` = его `username` или прежний email (у строки ещё нет `telegram_id`, адресовать её числом нечем). Профиля до первого входа не существует (`user_profiles.telegram_id` → FK на `allowed_users.telegram_id`), поэтому такому ref принимается **только `email`**, остальные поля → 400. Разбор ref (число / email / username) — единый канон `_shared/users/user-ref.ts` (`parseUserRef`), им же адресуется `DELETE /admin/workspaces/:wsId/users/:userId`.

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
| `GET` | `/recorder/setup` | `{ active, expiresAt }` — статус токена рекордера (для секции «Рекордер встреч» в вебе). Хелперы — `_shared/recorder-token.ts` |
| `POST` | `/recorder/token` | Минт/перевыпуск токена рекордера → `{ oneLiner, expiresAt }`; токен ОТДЕЛЬНЫЙ от MCP, доступно всем участникам |
| `GET` | `/mcp/setup` | `{ active, expiresAt }` — статус MCP-токена Claude Desktop (для секции «Claude Desktop» в вебе). Хелперы — `_shared/mcp-token.ts` |
| `POST` | `/mcp/token` | Минт/перевыпуск MCP-токена → `{ oneLiner }` (команда установки `/setup`); токен бессрочный, доступно всем участникам |
| `GET` | `/mcp/instructions` | `{ instructions }` — текст инструкций для проекта Claude Desktop (поле Instructions), персонализирован Telegram ID. Зеркало бот-команды `/claude`; единый источник — `_shared/claude-project-prompt.ts` (кнопка «Инструкции для проекта» в секции «Claude Desktop» веба) |
| `GET` | `/users` | Участники воркспейса с профилями |

_Задачи / спринты / зависимости:_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/tasks` | Список задач. Фильтры: `status`, `country`, `assignee`, `mine`, `limit`, `confirmed`, `sprint_id`, `project_id`, `tags` (csv, ANY), `label_id`, `start_date_from/to`, `due_date_from/to`. **Лимит: дефолт и потолок 2000** (`TASKS_LIST_LIMIT`), разбор `?limit=` — `parseListLimit` в `http.ts`. **Ответ СПИСОЧНЫЙ** — проекция `TASK_LIST_COLUMNS` (22 колонки из 35) + заголовок `X-Total-Count`; см. ниже. Дефолт движка `_shared/tasks/db.ts` (200) для веба НЕ годится: экраны фильтруют статусы и линзы на клиенте, значит нужен полный набор; у бота 200 остаётся — он печатает список в чат (issue #111). Отдаёт `label_ids`, `project_id`, `project_linked`. **Приватность:** приватные задачи видны только владельцу (админ — все). Дополняется вычисляемым `created_by_name` (из `created_by_telegram_id`) |
| `GET` | `/tasks/:id` | Одна задача. Приватная чужая → 404 |
| `POST` | `/tasks` | Создать (`assignee_telegram_id` → имя); поля Роя: `is_private` (→`owner_id`), `start_date`, `sprint_id`, `tags`, `timeline_position`, `project_id`/`project_linked`, `parent_id` (подзадача: родитель того же воркспейса → форс `project_linked`), `tree_x`/`tree_y` (позиция узла); валидация `start_date<=due_date` и принадлежности спринта/проекта воркспейсу; `confirmed=true`. `remind_date` (пинг) сохраняется вместе с `remind_set_by` = создатель. **`recur_freq`** (цикличность): проверяется и дополняется `recur_anchor_dom` из срока хелпером `resolveRecurrence` — без `due_date` → **400** («цикличность требует срока»), неизвестная частота → 400 |
| `PATCH` | `/tasks/:id` | Частичный апдейт. Приватную чужую → 404, мутация приватной не владельцем → 403. Поддержаны новые поля + смена `is_private`, привязка к спринту/проекту, `parent_id`/`tree_x`/`tree_y`. `project_id` проверяется на воркспейс (400 иначе); `project_id:null`/`project_linked:false` → сброс `parent_id`; `project_linked:true` без `project_id` → 400. **`parent_id`**: родитель того же воркспейса, **защита от цикла** (нельзя к своему потомку → 400), форс `project_linked=true`. **Каскад**: отвязка узла (`project_linked=false`) переводит всё его поддерево в бэклог. `label_ids` — только на своей личной задаче, иначе **400**. **`remind_date`** (пинг): любая правка поля СБРАСЫВАЕТ `reminded_at` в null и переписывает `remind_set_by` на правящего — иначе перенесённый пинг молча не пришёл бы (крон берёт только неотправленные). **`recur_freq`** (цикличность, `null` — снять): `recurrencePatchFor` проверяет частоту и решает, трогать ли `recur_anchor_dom` — **якорь пересчитывается ТОЛЬКО когда изменился срок или частота**, иначе автосейв `TaskModal` (шлёт оба поля при каждой правке) увёл бы зажатую задачу с 31-го числа на 28-е. Регулярная задача **без срока отбивается 400** — снять срок можно только вместе с цикличностью, иначе она молча перестала бы повторяться. ⚠️ **`status:"done"` у регулярной задачи задачу НЕ закрывает**: `updateTask` подменяет патч на перекат (срок → следующее вхождение, `status` → `open`) и возвращает `{ recurred: { from, to } }` |
| `DELETE` | `/tasks/:id` | Удалить (204). Приватную чужую → 404/403 |
| `POST` | `/tasks/extract` | Извлечь задачи из текста через GPT-4o-mini. `{ save:false }` → **preview**: вернуть предложенные задачи БЕЗ создания (≤10, ревью на экране встреч). Без `save:false` (по умолчанию) — старое поведение: создать задачи и вернуть |
| `GET` | `/projects` | Проекты воркспейса, отфильтрованные по видимости (не-админу — без чужих приватных: `parent_id≠null` ИЛИ `is_private=true` и `created_by` не свой, см. §Таблицы БД → `projects`), с вычисленными `task_count`/`backlog_count` (одним запросом, без N+1) — `_shared/tasks/projects.ts` `listProjects` |
| `POST` | `/projects` | Создать проект `{ name, color?, emoji?, parent_id?, sprint_id?, is_private? }`; `created_by` = вызывающий. `parent_id` — опционально сделать подпроектом существующего верхнеуровневого проекта; `sprint_id` — вкладка-владелец (валидируется принадлежностью воркспейсу → иначе 400); `is_private` — тумблер приватности (по умолчанию `false`, имеет смысл только для верхнего уровня — подпроект и так приватен); невалидный `parent_id` (см. `validateParent` в §Таблицы БД → `projects`) → 400 |
| `PATCH` | `/projects/:id` | Обновить `{ name?, color?, emoji?, parent_id?, sprint_id?, is_private? }` своего воркспейса → 404, если чужой/приватный не свой/не найден (`canMutateProject`); `sprint_id` вне воркспейса → 400; невалидный `parent_id` → 400 |
| `DELETE` | `/projects/:id` | Удалить проект своего воркспейса (404, если чужой/приватный не свой/не найден — та же `canMutateProject`). Задачи проекта: `project_id→NULL` (FK `ON DELETE SET NULL`) + явный сброс `project_linked=false` |
| `GET` | `/task-labels` | Персональные смарт-метки вызывающего (`owner_id = telegram_id`) + счётчик задач в каждой |
| `POST` | `/task-labels` | Создать метку `{ name, icon?, color? }` |
| `PATCH` | `/task-labels/:id` | Обновить `{ name?, icon?, color?, sort_order? }` — только владелец метки (иначе 404/403) |
| `DELETE` | `/task-labels/:id` | Удалить метку + вычистить её id из `tasks.label_ids` владельца — только владелец |
| `GET` | `/tasks/:id/comments` | Комментарии к задаче (старые→новые), с резолвом имени автора. Гейт = видимость задачи (`group_id` + приватность). Модуль `swarm-api/task-comments.ts` |
| `POST` | `/tasks/:id/comments` | Добавить комментарий `{content}` (≤4000 символов, валидатор `_shared/tasks/comments.ts`). Автор — вызывающий (`added_by_telegram_id`) |
| `DELETE` | `/tasks/:id/comments/:cid` | Удалить комментарий — только автор или админ |
| `GET` | `/tasks/:id/subscription` | Состояние подписки вызывающего: `{state: subscribed\|muted\|null, reason, notified}`. `notified` — придут ли уведомления сейчас (это и показывает тумблер в карточке). Модуль `swarm-api/task-subscriptions.ts` |
| `PATCH` | `/tasks/:id/subscription` | Явный выбор человека `{notify: boolean}` → `state` = `subscribed`/`muted`, `reason=manual`. Гейт тот же — видимость задачи |
| `GET` | `/notifications` | Лента уведомлений вызывающего (новые сверху, `?limit=` ≤100, по умолчанию 30) + счётчик `unread`. Строго свои: фильтр по `recipient_telegram_id`. Задача, ставшая приватной ПОСЛЕ уведомления, из ленты выпадает (`canViewTask` на выдаче). Модуль `swarm-api/notifications.ts`. Вместе с лентой едет **`notice`** — объявление о раскатке (`{at, until}` из `app_settings.deploy_notice`, `null` если нет или истекло): у плашки в вебе нет своего поллинга, она берёт его отсюда. |
| `POST` | `/notifications/read` | Пометить прочитанным: `{ids}` — перечисленные, без тела — всё непрочитанное. Чужие не помечаются даже по точному id |
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

**⚡ Форма ответа `GET /meetings` — канон `swarm-api/meetings-payload.ts`** (issue #102, 26.08.2026):

| | что уезжает в браузер |
|---|---|
| **Колонки** | `ENTRY_COLUMNS` (канон — `entries-guard.ts`) — ровно поля `EntryRow`/клиентского `Entry` + `updated_at`. **`embedding` и `fts` НЕ запрашиваются никогда, ни списком, ни по одной записи** |
| **Большой список** (`?confirmed=true` или без параметра) | `content` и `summary` урезаны до `LIST_PREVIEW_CHARS` (400 симв.), у записи стоит **`truncated: true`** |
| **Очередь вычитки** (`?confirmed=false`) | полный текст, без урезания — там единицы строк и текст нужен сразу |

Зачем: хендлер делал `select("*")` и отдавал **~10 МБ на 230 встреч**, из которых 61% — `embedding` (4.2 МБ) и `fts` (1.8 МБ), т.е. колонки, которых нет в типе `Entry` и которые фронт физически не мог прочитать; ещё 2.7 МБ — полные транскрипты, в списке не рендерящиеся. Запрос к базе при этом занимает **1.3 мс** — узким местом была не выборка, а объём. После фикса тот же список — **452 кБ** (в 22 раза меньше).

**Контракт `truncated` обязателен к соблюдению на клиенте.** Экран, который открывает встречу **из объекта списка**, а не по `id`, обязан до-загрузить её через `fetchMeeting(id)` и до тех пор НЕ рисовать транскрипт/тезисы и НЕ давать извлечение задач — иначе обрезок в 400 символов выглядит как короткая, но полная встреча. Сейчас такой экран один — `MeetAdminScreen` (`selectItem`, режим «Все встречи»); остальные (`MeetingDetail`, `RecordDetail`, `AnswerModal`, дашборд, поиск) переходят по `id` и получают запись целиком.

**⚡ Форма ответа `GET /tasks` (списочный) — канон `swarm-api/task-columns.ts`** (issue #116):

Проекция `TASK_LIST_COLUMNS` — 22 колонки из 35. Замеры на проде (188 задач): **1146 → 583 Б на строку, −49%**. У задач нет одной жирной колонки вроде `embedding` у встреч: вес строки во многом составляют **имена полей JSON**, поэтому выигрыш даёт сам факт сокращения списка колонок, а не выброс одного поля.

Выброшено: `description` (307 Б, 27% веса — в строках списка не рендерится), `note` и `url` (в базе пусто), `tags`, `task_role`, `created_by`, `group_id`, `confirmed`, `owner_id`, `updated_at`, `timeline_position`, `remind_set_by` (списками не читаются — только серверные фильтры, оптимистичные литералы при создании и редактор).

**Догрузку полной задачи делает сам `TaskModal` — от вызывающих экранов ничего не требуется** (issue #145, 2026-08-28). Причина защиты не косметическая: `buildPatch()` собирает PATCH из **всех** полей формы, а не только изменённых, поэтому автосейв на урезанной задаче отправил бы `description: null` и `task_role: null` и **стёр реальный текст**. Механика:

1. `TaskModal` видит `task.description === undefined` → сам зовёт `fetchTask(id)` и держит результат в своём состоянии (сторож по `id`, а не по ссылке: объект задачи меняет идентичность при каждом обновлении списка);
2. `isPartial` **блокирует запись** — и автосейв, и досрочное сохранение при закрытии — пока полная версия не доехала. Форма на это время выключена целиком (`fieldset[disabled]`), в индикаторе «Загружаем…»;
3. догрузка не удалась → в карточке полоса «Не удалось загрузить задачу целиком» с кнопкой «Повторить», в индикаторе «Не загрузилось». Молчаливого read-only больше нет.

⚠️ **До 2026-08-28 это было ТРЕБОВАНИЕМ К ВЫЗЫВАЮЩЕЙ СТОРОНЕ**, и из пяти точек входа его соблюдала одна (`RoyApp.openTask`). Список (`RemindersTasks`), доска (`SprintBoard`), таймлайн (`TimelineView`) и облако проекта (`ProjectTree`) отдавали объект из проекции — карточка навсегда застревала в «Загружаем…» и **молча теряла все правки**: статус визуально переключался (включая `aria-pressed` для скринридера), PATCH не уходил. Урок общий: контракт, который держится на памяти пишущего новый экран, нарушается — защиту надо ставить туда, где её нельзя забыть. Локально баг не воспроизводился, потому что DEV-моки отдавали задачи целиком; теперь `fetchTasks` в моках режет `description` так же, как прод, а `fetchTask` отдаёт задачу полностью (как `select("*")` на сервере). Регресс держат проверки `miniapp/e2e/deep-flows.mjs` («карточка догрузила полную задачу», «статус пережил переоткрытие карточки»).

В типе `Task` (`miniapp/src/types.ts`) выброшенные проекцией поля помечены `?`: `undefined` значит «не загружено», пусто — это `null`. Детальные экраны (`TaskDetail`, `NewTask`) и `NotificationsBell` грузят задачу по id и контракта не касаются.

**`X-Total-Count`** — сколько задач подходит под фильтры без лимита; заголовком, а не конвертом, поэтому бот и MCP (у них `listTasks` без проекции) не задеты. Заголовок не ставится, когда счётчик соврал бы: фильтр по имени исполнителя доклеивается в JS уже после выборки. В CORS добавлен `Access-Control-Expose-Headers` — без него браузер не отдал бы заголовок коду страницы.

Движок `_shared/tasks/db.ts`: `listTasksWithTotal` возвращает `{ tasks, total }`, `listTasks` — обёртка только со списком (её и зовут бот и MCP). Колонки передаются параметром `columns`, по умолчанию `*`: боту нужен `description` для формата сообщения.

**⚠️ Лимиты списочных ответов — `parseListLimit` в `swarm-api/http.ts`** (issue #111):

| эндпоинт | дефолт | потолок | почему столько |
|---|---|---|---|
| `GET /tasks` | 2000 | 2000 | Веб фильтрует статусы и линзы НА КЛИЕНТЕ → нужен полный набор. Дефолт движка 200 верен только для бота (печатает список в чат) |
| `GET /meetings` | 500 | 2000 | Список «Все встречи» + клиентские фасеты |
| `GET /entries` | 50 | — | хардкод; **уже за потолком**: заметок 92 |
| `GET /agent-meetings` | 50 | — | хардкод; очередь вычитки не растёт линейно |

**Лимит применяется ПОСЛЕ сортировки, поэтому режет не «лишнее», а конец порядка.** У задач порядок — `due_date ASC nulls last`, значит первыми отваливаются задачи **без срока**. Проверено на проде: при лимите 150 из 188 задач отрезается 38, и все 38 — без срока, со сроком ноль. Под них на дашборде есть отдельная секция «Мои задачи без срока» — она бы просто опустела.

`parseListLimit` возвращает дефолт на мусор и на `?limit=0`/отрицательное: `parseInt("abc")` даёт NaN, а `0` — пустой список, и оба случая раньше проходили молча.

**Усечение пока НЕ громкое** (ответ — голый массив, признака в нём нет) — это #112. До него в `GET /tasks` стоит breadcrumb: `console.warn`, когда ответ упёрся в лимит, чтобы увидеть в `function_edge_logs` раньше, чем заметит команда.

**⚡ Форма ответа `GET /agent-meetings` (списочный)** — `toAgentListRow` в `meetings-payload.ts` (issue #108):

`draft_notes_md` (полные тезисы черновика) заменён признаком **`has_draft_notes: boolean`**. Список рисует название, дату и статус, а текст ехал в **10-секундном поллинге** экрана ревью: 154 кБ за опрос на 18 черновиках ≈ **55 МБ в час** на одной открытой вкладке. Полный текст (и `transcript`, и `summary_status`, и `attendees`) отдаёт деталь `GET /agent-meetings/:id`.

Пустая строка тезисов считается «не готово» — иначе список рапортует «готово» на пустышке.

**На клиенте готовность проверяется ТОЛЬКО через `hasDraftNotes()`** (`miniapp/src/lib/agentMeeting.ts`), а не через `m.draft_notes_md === null`: экраны получают то списочную форму (флаг, текста нет), то детальную (текст, флага нет), и прямая проверка на списке давала бы ложное «готовим тезисы…» для всех. Помни, что `summary_status` списком тоже НЕ приходит (и не приходил никогда — тип это скрывал).

_Встречи — `/meetings` (подтверждённые записи-встречи в `entries`):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/meetings` | Записи-встречи (`entry_type=meeting`). `?confirmed=true/false` фильтрует по `metadata.confirmed` (очередь «на согласовании»), `?limit=` (дефолт 500, потолок 2000). **Ответ СПИСОЧНЫЙ и урезанный** — см. ниже |
| `GET` | `/meetings/:id` | Одна встреча-запись (`getEntrySecure`) |
| `PATCH` | `/meetings/:id` | Правка: `confirmed` (в `metadata`), `summary`, `content`, `entry_type` (реклассификация «встреча → заметка», уводит из очереди), `is_private` (+`owner_id` как у задач), `countries` |
| `DELETE` | `/meetings/:id` | Удалить встречу-запись (204) |
| `POST` | `/meetings/:id/resummarize` | Пересобрать тезисы ОПУБЛИКОВАННОЙ встречи текущим промптом из транскрипта связанной `meetings`-строки (`metadata.meeting_id`) → обновляет `summary`+`content`+`embedding` (`resummarizeFromTranscript`) |

_Встречи — `/agent-meetings` (черновики рекордера в таблице `meetings` до публикации):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/agent-meetings` | Очередь вычитки / опубликованные (`?status=awaiting_review\|in_base`). Видны **только записавшим** (`recorders`) — админ НЕ исключение (решение владельца 2026-08-20). Прежний `?all=true` убран; пригляд — агрегат `GET /admin/review-counts`. **Ответ СПИСОЧНЫЙ:** без `draft_notes_md`/`transcript`, вместо текста тезисов — признак `has_draft_notes` (issue #108) |
| `GET` | `/agent-meetings/:id` | Черновик `draft_notes_md` + транскрипт |
| `PATCH` | `/agent-meetings/:id` | Правка `draft_notes_md` → `notes_edited_at` (и/или `title`) |
| `DELETE` | `/agent-meetings/:id` | Удалить черновик (до публикации) |
| `POST` | `/agent-meetings/:id/publish` | Аппрув: `{ base: workspace\|personal, countries?: string[] }` → создать `entries` + эмбеддинг, привязать, `status=in_base`; идемпотентно. `countries` — рынки, выставленные человеком чипами на вычитке (issue #73): переданы → классификатор не зовётся вовсе, но значение проходит через `marketTagsFromInput` (нормализация + сентинел + **порог 2+**: 1 рынок → тег, 0 или ≥2 → `["General"]`; issue #167, решение владельца 2026-08-28 — чипы предзаполнены подсказкой, поэтому «выбрал человек» часто значит «предложила система»); поля нет → прежнее поведение авто-классификатора. Задачи **не** извлекаются автоматически (только по кнопке, см. `/tasks/extract`) |
| `GET` | `/agent-meetings/:id/market-suggestion` | Что предложить в чипах рынков на вычитке → `{ markets: string[], source: "title"\|"participants"\|"notes"\|null }`. Логика — `_shared/market-suggest.ts` `pickSuggestedMarkets`: приоритет сигналов **название встречи → пересечение рынков участников (`user_profiles.markets` по e-mail из `attendees`) → классификатор по тезисам**; первый сработавший побеждает, они не складываются. **Больше ОДНОГО рынка не предлагается** (`MAX_SUGGESTED = 1`, issue #167: было 2, и два предложенных рынка уезжали в базу как два страновых тега — встреча попадала в дайджест обеих стран); сигналов нет → пусто (= «Общее»). Дорогой классификатор зовётся ТОЛЬКО когда название и участники молчат |
| `POST` | `/agent-meetings/:id/resummarize` | Пересобрать тезисы черновика текущим промптом из сохранённого транскрипта (`resummarizeFromTranscript`, без ре-транскрибации); до публикации. Сама сводка вынесена в `buildTezisyFromTranscript` — тот же путь БЕЗ записи в базу («сухой прогон»): промпт можно проверить на реальной встрече, не затирая ни авто-тезисы, ни правки человека (`notes_edited_at` стоит у половины встреч) |

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
| `GET` | `/search?q=` | Гибридный поиск по `entries` (`match_entries_hybrid`: русский full-text + вектор через RRF, **фильтр по стране** (когда названа — пул кандидатов = записи этой страны ИЛИ `General`; чужие страны отсекаются) + буст этой страны в ранге + окно свежести — сначала ≤2 нед, добор старых при <5 источников, ступенчатый буст recency; страна детектится из текста запроса — `detectQueryCountry`, понимает русские склонения («Сербии»/«Сербией» → RS, стем+падежное окончание, без ложных «индикатор»/«грузить»); миграция `20260730120000_search_country_filter`) → `Entry[]`  🔒 **Невычитанная встреча в выдачу НЕ попадает** (issue #70, 2026-08-24): `entry_type='meeting'` участвует в поиске только при `metadata.confirmed='true'`. Read.ai создаёт встречу общей и несогласованной, поэтому сырой транскрипт находился всей командой до вычитки; гард очереди (#66) поиск не закрывал — он ходит прямо в RPC. Фильтр добавлен в ОБЕ перегрузки `match_entries_hybrid` и в каждой ДВАЖДЫ (full-text и векторная ветки) + в `match_entries`; миграции `20260824100000`, `20260824101500`. Заметки и документы не затронуты — поля `confirmed` у них нет. |
| `POST` | `/ask` | RAG-ответ (экран Answer редизайна): embed → `matchEntries` (топ-8, приватность+воркспейс в RPC) → GPT-4o-mini синтез строго по источникам со сносками `[n]` → `{ query, answer, sources[], followups[] }`. Пусто → без GPT; сбой синтеза → деградация до источников |
| `POST` | `/digest` | Персональный дайджест за период (`{ days }`, дефолт 7): GPT-сводка по `entries` воркспейса (приватность учтена) СТРОГО по рынкам пользователя. Охват решает `resolveDigestScope` (`swarm-api/digest-scope.ts`) по НОРМАЛИЗОВАННЫМ кодам стран: рынки есть → фильтр `countries ∩ markets`; админский `all_countries` → весь воркспейс; **рынков нет → `{ text: "", needs_markets: true }`, дайджест не строится** (issue #154 — раньше пустой `markets` молча снимал фильтр и человек получал сводку по чужим странам). Подсказку «где настроить» рисует веб, сервер отдаёт признак; записей нет → текстовая заглушка |
| `POST` | `/feedback` | **multipart/form-data**: `text` (обяз.) + `category` + опц. `screenshot` (файл → `swarm_drive`). Сохраняет в `feedback` (`source='web'`, username из `allowed_users`) + пинг в канал `feedback_channel_id` (без кнопок); 204 |

_Админка (`admin.ts`, админы: `telegram_id 744230399` или `is_admin=true`):_

| Метод | Путь | Что делает |
|-------|------|-----------|
| `GET` | `/admin/review-counts` | Сводка «на вычитке по участникам»: `[{telegram_id,name,count}]` — агрегат непубликованных встреч (entry confirmed=false по `owner_id`/`added_by` + рекордер-черновики awaiting_review по `recorders[]`) воркспейса админа. Только число, БЕЗ контента (приватность чужого) |
| `GET` | `/admin/workspaces` | Список воркспейсов с user_count |
| `GET` | `/admin/workspaces/:id/users` | Пользователи воркспейса |
| `POST` | `/admin/workspaces/:id/users` | Добавить пользователя |
| `DELETE` | `/admin/workspaces/:id/users/:uid` | Удалить пользователя |
| `PATCH` | `/admin/workspaces/:id` | Обновить name/allowed_markets |
| `PATCH` | `/admin/users/:ref` | Правка профиля (`user_profiles`) по `telegram_id`; для ОЖИДАЮЩЕГО приглашения `ref` = username/email и принимается только `email` → `allowed_users.email` |

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
| `search_knowledge` | Гибридный поиск по базе знаний (full-text + вектор через RRF) |
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
| `get_feedback` | Фидбек пользователей (баги/идеи), фильтры `status`/`category`; **владелец-only**, по умолчанию незакрытые |
| `resolve_feedback` | Пометить фидбек `triaged`/`done`/`wontfix` (+ опц. `task_id`); **владелец-only** |
| `add_task` | Создать задачу (с fuzzy-матчингом исполнителя). Параметр `labels` (имена личных смарт-меток) — резолв/авто-создание меток владельца, задача становится личной. `recur_freq` (`daily`/`weekly`/`monthly`) — цикличность; **требует `due_date`**, иначе отказ |
| `update_task` | Обновить задачу. Параметр `labels` — только для своей личной задачи. `recur_freq` (`null` — снять) идёт через `recurrencePatchFor`, поэтому якорь числа месяца не сбивается при правке других полей. ⚠️ `status:"done"` у регулярной задачи её НЕ закрывает — срок переносится на следующее вхождение (описание тулзы предупреждает об этом Claude явно) |
| `delete_task` | Удалить задачу |
| `get_tasks` | Список задач с фильтрами (в т.ч. `label` — имя личной смарт-метки) |
| `list_task_labels` | Список личных смарт-меток вызывающего (имя + id) |
| `get_task_comments` | Комментарии-апдейты к задаче по её ID (если задача доступна вызывающему) |
| `add_task_comment` | Добавить комментарий-апдейт к задаче по её ID от лица вызывающего |

Все инструменты принимают `requesting_user_id` (Telegram ID) для резолва воркспейса и приватности.

---

## app_settings — ключи

| Ключ | Тип значения | Назначение |
|------|-------------|-----------|
| `feedback_channel_id` | number (chat_id) | Telegram-группа для пересылки фидбеков. Текущее значение: `-1003955027649` |
| `granola_last_polled_at` | ISO timestamp | Время последнего опроса Granola-поллером |
| `deploy_notice` | `{at, until}` (ISO) | Объявление «скоро обновление» → плашка в вебе. `until` — срок годности В ДАННЫХ: плашка гаснет сама, даже если скрипт раскатки упал и не снял её. Ставит/снимает `scripts/deploy-notice.sh` (его зовёт `make notice` и сам `deploy-window.sh go`). Отсутствие строки = объявления нет |

---

## Веб-интерфейс frontend — miniapp/

Next.js 16, `output: "export"` (статический HTML/CSS/JS в `miniapp/out/`, без сервера) → Cloudflare Pages, **авто-деплой с `main`** (см. [QUICK_REF → Деплой](QUICK_REF.md)). Монорепо, полностью отдельно от Deno Edge Functions. Дизайн-система «Рой» (`src/components/roy/`) под хендофф `design_handoff_roy`. Разработка: `cd miniapp && npm run build`.

> **Канон фронтенда — [MINIAPP_ARCHITECTURE.md](MINIAPP_ARCHITECTURE.md)** (стек, дизайн-токены, IA/`RoyApp`, экраны, дашборд, виды задач, API-контракт, auth, env). Типы/клиент — `miniapp/src/types.ts`, `miniapp/src/lib/api.ts`. Env — §[Переменные окружения](#переменные-окружения). Здесь не дублируем.

---

## Деплой и разработка

- Ветка: `main` → всегда разрабатывать здесь (дефолтная на GitHub)
- Деплой Edge Functions: `supabase functions deploy swarm-bot --no-verify-jwt`
- ⚠️ `granola-poller` — legacy, **не деплоить** как обычный шаг: standalone-функция выведена из крона. Поллинг Granola идёт внутри `swarm-bot` (часовой крон с `{granola_poll:true}` → `ingestNewGranolaNotesAllUsers`). См. таблицу Edge Functions выше.
- Деплой веб-интерфейса: `cd miniapp && npm run build` → `out/` → Cloudflare Pages
- После каждого изменения функционала: обновить этот файл (ARCHITECTURE) + `docs/BACKLOG.md`. **Changelog руками не вести** — генерируется из git (`scripts/changelog.sh`); источник истины — conventional commit-сообщения.
