# Swarm Brain — Quick Reference

> Читай этот файл в начале сессии. За деталями — [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Деплой

```bash
supabase functions deploy swarm-bot --no-verify-jwt          # всегда --no-verify-jwt
supabase functions deploy swarm-setup --no-verify-jwt        # публичный GET, Claude Desktop installer
supabase functions deploy swarm-recorder-setup --no-verify-jwt  # публичный GET, установщик рекордера (/recordertoken)
supabase functions deploy swarm-recorder-version --no-verify-jwt # публичный GET, последний build рекордера (тихий авто-апдейт; runbook раскатки — recorder/README.md)
supabase functions deploy meeting-ingest --no-verify-jwt     # приём аудио → Storage → durable-обработка
supabase functions deploy meeting-process --no-verify-jwt    # cron-воркер durable-обработки (pg_cron 'meetings-process', каждую минуту)
supabase functions deploy meeting-status --no-verify-jwt     # статус встреч пачкой (рекордер чистит локальный бэкап по done)
supabase functions deploy meeting-heartbeat --no-verify-jwt  # heartbeat рекордера → watchdog checkRecorderHealth (оборванная запись / истечение токена)
supabase functions deploy meeting-webtoken --no-verify-jwt   # обмен recorder-токена на web-JWT (cookie roj_session) для панели /live в WKWebView рекордера
# granola-poller — legacy, НЕ деплоить: поллинг Granola внутри swarm-bot ({granola_poll:true} крон)
# daily_report_cron — ежедневный отчёт активности админу (pg_cron '0 6 * * *' → swarm-bot {"daily_report_cron":true})
# review_reminders_cron — напоминалка владельцу про невычитанные встречи >48ч, кнопка в веб (pg_cron 'review-reminders-hourly' почасовой, гейт рабочих часов Белграда в коде → swarm-bot {"review_reminders_cron":true})
# feedback_retention_cron — чистка закрытого фидбека (done/wontfix >90 дней) + скрины в swarm_drive (pg_cron раз в сутки → swarm-bot {"feedback_retention_cron":true}; регистрация pg_cron — вручную в проде, как остальные)
supabase secrets set BOT_NAME=swarm-bot                       # env-переменные
```

> **`--no-verify-jwt` теперь ЗАКРЕПЛЁН в `supabase/config.toml`** (`[functions.<name>] verify_jwt = false` для всех 15 функций). Флаг в командах выше — подстраховка, конфиг и так делает функции публичными на шлюзе. **Не ставь `verify_jwt = true`** ни одной функции: рекордер/вебхуки/бот шлют не-JWT `Bearer`-токены и делают свою авторизацию в коде → шлюз с verify_jwt отобьёт их 401 `INVALID_JWT_FORMAT` ещё до функции (так в 2026-06-30 молча падали ВСЕ загрузки рекордера — разбор в BACKLOG).

### Веб (miniapp) — Cloudflare Pages, АВТО (руками НЕ деплоить)

> Проверено 2026-06-28 через CF API. Веб «Рой» выкатывается **сам** на каждый push в `main` — отдельный ручной шаг НЕ нужен (в отличие от edge-функций выше).

- **Проект:** `swarm-brain` → `https://swarm-brain.pages.dev`, git-привязка к `GarroV/Swarm-brain`, **production branch = `main`** (переключено в дашборде CF при ренейме 2026-07-25).
- **Build:** root dir `miniapp`, command `npm run build`, output `out`. Pages Functions из `miniapp/functions/` (прокси авторизации `/api/*`) деплоятся вместе.
- **Цикл:** push в `main` → авто-сборка CF → прод за ~1–3 мин (проверено: последние деплои `deploy/success`).
- **Env** (живут в дашборде CF Pages → Settings → Variables, НЕ в репо): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BOT_USERNAME`, `NEXT_PUBLIC_DEV_MODE`, `SWARM_API_URL`, `TELEGRAM_BOT_TOKEN`, `WEB_JWT_SECRET`.
- Конфиг живёт **только в дашборде CF** (в репо нет `wrangler`/`.github/workflows` — и не нужно, git-интеграция сама собирает).
- **Нюанс URL:** CF Pages срезает `.html` → `/foo.html` отдаёт 308 на `/foo` (напр. `/system-map.html` → `/system-map`). Ссылки лучше без `.html`.
- **«В проде старая версия»?** Это НЕ деплой (он работает), а залипший клиентский **service worker / PWA-кэш** → ⌘⇧R / Unregister SW / перезапуск PWA. См. `BACKLOG.md` → «Веб (miniapp): деплой РАБОТАЕТ».

**Ветка:** `main` (дефолтная) — разработка здесь.

---

## 🧭 Навигационный индекс — «где что» (канон, ищи здесь первым)

> Цель: найти файл за секунды, не перечитывая репо. `§` = раздел в [ARCHITECTURE.md](ARCHITECTURE.md); spoke = отдельный док.

### Бот (Telegram) — `swarm-bot/`
| Concern | Файлы | Детали |
|---|---|---|
| Команды, роутинг входящего (сохранить vs искать) | `swarm-bot/index.ts`, `lib/intent.ts` | §swarm-bot, §Роутинг входящего |
| Гейт групповых чатов (в группе — только по команде/@упоминанию) | `swarm-bot/lib/group-gate.ts`, `lib/telegram.ts` (`getBotUsername`) | §Роутинг входящего |
| Сохранение записи (saveEntry/индекс), сессии, доступ | `swarm-bot/lib/storage.ts` | §Флоу сохранения, §Сессионный механизм |
| Правка/удаление записей из чата | `swarm-bot/handlers/manage.ts` | §Управление записями |
| Воркспейсы | `swarm-bot/lib/workspace.ts` | §Воркспейсы |
| Фидбек (приём бот+веб, категории, скрины, разбор) | бот `swarm-bot/handlers/feedback.ts`; веб `swarm-api` `POST /feedback` + `miniapp/.../roy/{FeedbackForm,FeedbackFab}.tsx`; разбор `swarm-mcp` (`get_feedback`/`resolve_feedback`); канон категорий `_shared/feedback-categories.ts` | §Таблица feedback |
| Telegram helpers / новый хендлер | `swarm-bot/lib/telegram.ts`, `handlers/<name>.ts` | §swarm-bot |
| `ADMIN_USER_ID` (зашит) | `swarm-bot/lib/supabase.ts` → `744230399` | §Контроль доступа |

### Веб-бэкенд (веб-интерфейс) — `swarm-api/`
| Concern | Файлы | Детали |
|---|---|---|
| Все HTTP-эндпоинты (задачи/entries/встречи/поиск/дайджест) | `swarm-api/index.ts` | §swarm-api (канон эндпоинтов) |
| **Доступ к `entries`** (приватность+воркспейс) — НЕ грепать напрямую | `swarm-api/entries-guard.ts` | §Контроль доступа |
| Админка (воркспейсы/бродкаст/профили) | `swarm-api/admin.ts` | §swarm-api |
| Auth (initData / agent-токен / web-JWT) | `swarm-api/auth.ts`, `_shared/agent-auth.ts`, `_shared/jwt.ts` | §MCP-аутентификация |
| 🔍 Веб-логин отбивается (вход через Telegram-виджет → возврат на `/login`, 401 на `/api/me`) | **Рассинхрон `WEB_JWT_SECRET`**: Cloudflare Pages подписывает cookie `roj_session`, а swarm-api проверяет своим значением — если они разные, `verifyJWT`→null→401. Реализации JWT (`_lib/jwt.ts` CF ⟷ `_shared/jwt.ts`) идентичны, дело только в ключе. Починка: единый ключ в ОБА места — `printf %s $S \| wrangler pages secret put WEB_JWT_SECRET --project-name swarm-brain` + `supabase secrets set WEB_JWT_SECRET=$S`, затем передеплой `swarm-api`/`meeting-webtoken`/`google-oauth` и retrigger CF Pages. _(Исторически: вход через Telegram Mini App (tma initData) этим НЕ затрагивался — отсюда старое «у владельца работает, у веб-юзера нет». Mini App-вход **отключён** ~2026-07-15; сейчас ВСЕ ходят через браузерный JWT, так что рассинхрон `WEB_JWT_SECRET` теперь бьёт по всем без исключения.)_ | §MCP-аутентификация |

### Задачи (общий движок) — `_shared/tasks/`
| Concern | Файлы | Детали |
|---|---|---|
| CRUD/спринты/типы | `_shared/tasks/{db,sprints,types}.ts` | spoke [SHARED_TASKS_ENGINE.md](SHARED_TASKS_ENGINE.md) |
| Бот-обёртка / MCP-прослойка / fuzzy-assignee | `swarm-bot/tasks/{db,handlers,matcher}.ts`, `swarm-mcp/tasks/tools.ts` | §Движок задач |
| Персональные смарт-метки (личные списки) | БД `task_labels` + `tasks.label_ids`; API `swarm-api/task-labels.ts` (+`http.ts`); MCP `swarm-mcp/tasks/tools.ts` (`list_task_labels`, `labels`); веб `miniapp/src/components/tasks/{PictogramPicker,LabelEditor}.tsx`, `lib/smartLists.ts` (`filterByLabel`) | §Таблицы БД, §swarm-api, §swarm-mcp |
| Комментарии задач (история + добавление, кликабельные ссылки) | API `swarm-api/task-comments.ts`; MCP `swarm-mcp/tasks/tools.ts` (`get_task_comments`/`add_task_comment`); валидатор `_shared/tasks/comments.ts`; **веб — переиспользуемый `miniapp/src/components/tasks/TaskComments.tsx`** (встроен в `TaskModal.tsx` для существующей задачи И в `screens/TaskDetail.tsx`), ссылки `miniapp/src/lib/linkify.tsx` (только http/https, без `dangerouslySetInnerHTML`); `lib/api.ts` | §Таблицы БД, §swarm-api, §swarm-mcp |
| **Вкладки доски ВЛАДЕЮТ проектами** (2026-08-09): каждая вкладка (`sprints`) содержит свои проекты (`projects.sprint_id`) — переключение вкладки показывает её проекты, «+ Проект» создаётся в текущую вкладку (на «Все» кнопка скрыта). Задача принадлежит вкладке через свой проект (`task.sprint_id` доской больше не читается). Вкладки общие на воркспейс (приватности нет); существующие проекты перенесены в вкладку «Гарро». **Проекты = секции доски, с вложенными подпроектами** (2 уровня, добавлено 2026-08-07). Доска спринта разбита на пользовательские **секции-swimlane = проекты** (`projects`, владелец создаёт «+ Секция»), у каждой 4 колонки по статусу: **Бэклог/Открыто/В работе/Готово**. Проект без родителя (`parent_id=null`) — либо обычная секция (нет детей → один канбан, как раньше), либо **группа**, если у него есть подпроекты (`projects.parent_id`, ровно 2 уровня — подпроект не может иметь своих детей): рендерится рамкой с заголовком, внутри — свой канбан на КАЖДЫЙ подпроект + ряд **«Общее»/«General»** для задач, привязанных прямо к группе (`tasks.project_id` = id группы, не подпроекта). Задача принадлежит секции/подпроекту через `tasks.project_id`, колонка — через `tasks.status` (`backlog`/`open`/`in_progress`/`done`). Валидация вложенности — `validateParent` в `_shared/tasks/project-nesting.ts` (родитель существует в воркспейсе, сам верхнего уровня (не подпроект — не глубже 2 уровней), без self-parent, проект с подпроектами нельзя самого сделать подпроектом), вызывается из `POST`/`PATCH /projects`; нарушение → 400. Веб — `SprintBoard.tsx`; создание секций/подпроектов — `createProject({ name, parent_id? })`, задач — `createTask` (`status:"backlog"`). ⚠️ Вкладка **«Проекты» (react-flow дерево) ОТКЛЮЧЕНА** (закомм. в `TasksScreen.tsx`); код `ProjectsGrid/ProjectTree/treeGeom` + `tasks.parent_id/tree_x/tree_y` (это `tasks.parent_id`, НЕ `projects.parent_id` — разные таблицы, тёзки) оставлены на случай возврата, но в UI не используются | §Таблицы БД (`projects`, `tasks.project_id/status`), §swarm-api |
| 🔒 **Видимость/приватность — кто что видит** (`is_private=true` — только владелец `owner_id`; изоляция по `group_id`). **ЗАДАЧИ:** админ/руководитель видит чужие приватные (оверсайт, намеренно). **ЗАПИСИ/ВСТРЕЧИ:** приватное видит ТОЛЬКО владелец — **admin-байпаса НЕТ** (решение владельца 2026-08-07) | задачи → `_shared/tasks/db.ts` (`listTasks`, admin-байпас); встречи=записи → `swarm-api/entries-guard.ts` (`getEntrySecure`/`buildEntriesQuery` — без `isAdmin`), MCP `swarm-mcp` `get_meetings` | **[ARCHITECTURE.md](ARCHITECTURE.md) §Контроль доступа — единый канон** |

### Поиск / записи / страны
| Concern | Файлы | Детали |
|---|---|---|
| RAG / гибридный поиск (full-text+вектор RRF; **страна = ФИЛЬТР** когда названа в запросе — только её записи + `General`, чужие отсекаются; + буст свежести) / matchEntries → RPC `match_entries_hybrid` (миграция `20260730120000`) | `_shared/search.ts` (+ `swarm-api` `/search`,`/ask`,`/digest`); детект страны `_shared/countries.ts` `detectQueryCountry` (понимает русские склонения: «Сербии»/«Сербией», без ложных «индикатор»/«грузить») | §swarm-api |
| Классификация стран (правило + **схлопывание** кросс-маркета: ровно 1 рынок → тег, 0 или **2+** → `General`; порог 3→2 с 2026-08-06) | `_shared/countries.ts` (`COUNTRY_PROMPT_RULE`), `_shared/meta-extract.ts` (`applyGeneralSentinel`); дизайн `docs/superpowers/specs/2026-08-06-country-attribution-consolidated.md` | §Флоу сохранения |

### Встречи — запись → транскрибация → тезисы → ревью
| Concern | Файлы | Детали |
|---|---|---|
| Экран встреч (доска, master-detail): левый переключатель **Ревью** (очередь на решение — черновики агента + неподтверждённые) / **Все встречи** (весь доступный пользователю список, `fetchMeetings()`, приватность на бэке). Режим приходит из `meetAdmin.params.mode` (`review`\|`all`). С главной карточка «Встречи» → «Ревью» (шапка) и «Все встречи» (футер) ведут на эту доску (как задачи), а не в отдельный таб | `roy/screens/MeetAdminScreen.tsx`, карточка `roy/dash/MeetingsApprove.tsx`; таб «cal» `roy/screens/RoyMeetingsScreen.tsx` (лента, остался в нижней навигации) | §Флоу встреч |
| Durable-обработка (транскрибация по куску) | `_shared/meeting-processor.ts`, `meeting-ingest/`, `meeting-process/` (cron); watchdog `swarm-bot/index.ts` `sweepStuckMeetings` | §Флоу встреч |
| Мониторинг рекордера (heartbeat, алерты) | `meeting-heartbeat/`, `swarm-bot/index.ts` `checkRecorderHealth`; Swift `SwarmClient.heartbeat`/`AppDelegate.sendHeartbeat`; поля `allowed_users.recorder_last_*` | §Edge Functions |
| Промпт тезисов (канон, DRY) + **запрет домысленных связей** (`NO_INVENTED_LINKS_RULE`: соседство реплик ≠ связь, «в контексте X» только если сказано прямо; нет ответа → «в записи не прозвучал»; развести ≠ выбросить) + словарь имён собственных (нормализация Wolt/Београд/Нови Сад/НТАК…) + guard пустого ответа GPT-5 (reasoning-burn → фолбэк) | `_shared/tezisy-prompt.ts`, `_shared/glossary.ts`, `_shared/openai-chat.ts` (+ `.test.ts`) | §Флоу встреч |
| Язык встречи / пин микрофона (язык-нейтральный автодетект, взвешенный по объёму реальной речи по всем частям; нет речи → без пина, без форс-ru) + галлюцинации Whisper (чёрный список фраз + повтор-детектор) | `_shared/meeting-lang.ts` (+ `.test.ts`), `_shared/whisper-hallucinations.ts` (+ `.test.ts`); вызов в `_shared/meeting-processor.ts` | §Флоу встреч |
| Ревью/правка/публикация/переобработка | `swarm-api` (`/agent-meetings*`,`/meetings*`), `miniapp .../screens/MeetAdminScreen.tsx`,`MeetingDetail.tsx` | §swarm-api, spoke [MINIAPP_ARCHITECTURE.md](MINIAPP_ARCHITECTURE.md) |
| Granola импорт / Read.ai / статус-бэкап | `swarm-bot/handlers/granola.ts`, `read-ai-webhook/`, `meeting-status/` | §Флоу встреч |
| Дедуп встреч (кросс-источниковый: Granola/рекордер/Read.ai) | `_shared/meeting-dedup.ts` (+ `.test.ts`); применён в `granola.ts`, `swarm-api` (publish/import), `read-ai-webhook/` | §Флоу встреч → Дедуп встреч |
| Календарь / участники (только календарные встречи; аудио-диаризации нет) | `meeting-current/`, `google-oauth/`, рекордер `MeetingIdentity.swift` | §Флоу встреч |

### Рекордер (macOS, Swift) — `recorder/`
| Concern | Файлы | Детали |
|---|---|---|
| Жизненный цикл/виджет/аплоад/нарезка/бэкап | `recorder/Sources/SwarmRecorder/**` (`AppDelegate`,`RecorderWidget`,`UploadQueue`,`Segmenter`,`SwarmClient`) | spoke [recorder/README.md](../recorder/README.md) |
| **Обрезка тишины перед Whisper** (речевые блоки, offset реального старта → −~60% Whisper-минут; env `SWARM_VAD_DB`/`SWARM_VAD_CUT`) | `recorder/Sources/SwarmRecorder/SilenceTrimmer.swift` + `Segmenter.segment(allowEmpty:)` | §Флоу встреч (meeting-ingest) |
| Релиз новой сборки (тег `recorder-build-N`) | `swarm-recorder-version/index.ts` (`LATEST_BUILD`) | recorder/README.md (runbook) |

### Frontend «Рой» (веб-интерфейс, браузер/PWA) — `miniapp/src/components/roy/`
| Concern | Файлы | Детали |
|---|---|---|
| Экраны/панели/дизайн-система/навигация | `miniapp/src/components/roy/**` (app/layout/screens); переиспользуемые компоненты задач — `miniapp/src/components/tasks/**` (напр. `TaskRow.tsx`) | spoke [MINIAPP_ARCHITECTURE.md](MINIAPP_ARCHITECTURE.md) |
| API-клиент / типы | `miniapp/src/lib/api.ts`, `miniapp/src/types.ts` | MINIAPP_ARCHITECTURE.md |

### MCP / установщики
| Concern | Файлы | Детали |
|---|---|---|
| MCP-инструменты (Claude Desktop) | `swarm-mcp/index.ts`, `swarm-mcp/tasks/tools.ts` | §swarm-mcp |
| Авто-сетап Claude Desktop (`/setup`) | `swarm-setup/script.ts`, `swarm-bot/lib/mcp-setup.ts` | §swarm-mcp |
| Подключение Claude — оба пути (Desktop + веб-коннектор claude.ai) | `swarm-bot/index.ts` (`/connect_claude`, `/setup`, `/mytoken`), `_shared/mcp-token.ts` | §MCP-аутентификация |
| Промт-инструкции для проекта Claude Desktop (поле Instructions) | единый источник `_shared/claude-project-prompt.ts` → бот `/claude` + swarm-api `GET /mcp/instructions` (кнопка в вебе `SettingsScreen.tsx` `ClaudeDesktopSection`) | §swarm-api |
| 🔍 «Токен протух» / `Invalid token` (диагностика) | токен **бессрочный** → это рассинхрон клиента, НЕ истечение. `_shared/mcp-token.ts`, `swarm-mcp/index.ts` (token check ~843), БД `allowed_users.claude_mcp_token_hash`. Проверка: `has_token=true, expires_at=null` → чинить клиента (`/mytoken`) | §MCP-аутентификация |
| Установка рекордера (`/recordertoken`) — **ПРЕДсобранный .app, без Xcode/CLT** (issue #19): скачать release-asset → снять карантин → per-machine cert (штатные openssl/security) → codesign → /Applications | `swarm-recorder-setup/script.ts`, сборка в CI `recorder/build-app-ci.sh` + `.github/workflows/recorder-release.yml`, `swarm-bot/lib/mcp-setup.ts` | recorder/README.md |

### Инвентари (канон — в ARCHITECTURE, не дублировать)
| Что | Где |
|---|---|
| Эндпоинты swarm-api | §swarm-api |
| Env / секреты | §Переменные окружения |
| Таблицы БД | §Таблицы БД |
| Callback / session-префиксы | §Callback-коды, §Сессионный механизм (выжимка — ниже) |

---

## Callback-префиксы — краткая выжимка (не создавай новые без проверки)

> Полный канонический список — в [docs/ARCHITECTURE.md](ARCHITECTURE.md) (раздел «Callback-коды»). Здесь — только самые ходовые.

| Префикс | Файл |
|---------|------|
| `gp_`, `gc_`, `gcp_`, `gd_`, `gedit_`, `gran_` | granola.ts |
| `mr_`, `mc_`, `mctry_`, `mctog_`, `mctry_done_`, `medit_`, `mrename_`, `mtr_`, `mtag_`, `massign_`, `md_`, `met_`, `med_`, `rai_`, `meeting_`, `mau_`, `mexp_` | meetings.ts (`mctry_/mctog_` — пикер рынков; не коллизят с `mc_`: после `mc` идёт `t`) |
| `sa_` | superadmin.ts |
| `tk_` | tasks/handlers.ts |
| `fb_`, `fbcat_` | handlers/feedback.ts (`fbcat_<cat>` — выбор раздела; `fb_read_` — legacy) |
| `kbpick_`, `kbdo_`, `kbask_`, `kbno` | handlers/manage.ts |
| `guide_open`, `guide_menu`, `guide_s1/2/3` | help.ts (мастер настройки — диспатч в index.ts) |

---

## Session action-префиксы — краткая выжимка (не создавай дубли)

> Полный канонический список — в [docs/ARCHITECTURE.md](ARCHITECTURE.md) (раздел «Сессионный механизм»). Здесь — только самые ходовые.

| Префикс | Файл |
|---------|------|
| `waiting_add`, `waiting_ask` | index.ts |
| `granola_*` | granola.ts |
| `meeting_*` | meetings.ts |
| `feedback_text`, `feedback_category`, `feedback_photo` | feedback.ts |
| `task_*` | tasks/handlers.ts |
| `user_*` | users.ts |
| `sa_*` | superadmin.ts |
| `manage`, `manage_replace` | handlers/manage.ts |

---

## Env-переменные

| Переменная | Обязательная |
|-----------|-------------|
| `TELEGRAM_BOT_TOKEN` | да |
| `SUPABASE_URL` | да |
| `SUPABASE_SERVICE_ROLE_KEY` | да |
| `OPENAI_API_KEY` | да |
| `BOT_NAME` | нет (дефолт `"bot"`) |
| `MCP_AUTH_REQUIRED` | нет; `true` = жёсткий режим MCP-токена |

---

## app_settings (живые значения в БД)

| Ключ | Значение |
|------|---------|
| `feedback_channel_id` | `-1003955027649` |
| `granola_last_polled_at` | обновляется поллером |

---

## Воркспейсы

- `cee` — CEE
- `other` — Other Markets
- Изоляция: все запросы к `entries` и `tasks` фильтруются по `group_id`
- `SERVICE_ROLE_KEY` везде → RLS не работает → вся защита через код

---

## Правила после изменений

1. **Новая фича? Сначала ресёрч** (как решают другие: GitHub / доки) — глобальный принцип №1; на багфикс не разводить.
2. Обновить `ARCHITECTURE.md` (флоу/таблица/callback/сессия) и `BACKLOG.md` (закрыл/завёл долг).
3. **Changelog НЕ вести руками** — генерируется из git (`scripts/changelog.sh`); commit-сообщения = источник истины (conventional).
4. Закоммитить (`main`) + сразу `git push`.
5. Задеплоить (`--no-verify-jwt`).
6. **Проверить, что не отвалилось** (принцип №2): `deno check` + смоук реального флоу; что не проверил — сказать прямо.

---

## Доки — держать живыми (на поток)

- **🧭 Индекс выше — единый вход.** Меняешь подсистему → проверь, что её строка в индексе и инвентарь в ARCHITECTURE актуальны (тем же коммитом — часть DoD).
- **Инвентари сверяй скриптом, не глазами:** `./scripts/doc-inventory.sh [endpoints|env|functions|tables|callbacks]` печатает факты ИЗ КОДА → сверь с таблицами в ARCHITECTURE. Расхождение = дрифт (код не задокументирован / дока устарела).
- **Перед крупным мёржем или раз в квартал** — drift-аудит скиллом `keeping-docs-current` (`~/.claude/skills/keeping-docs-current/drift-audit.workflow.js`): перечисляет публичные поверхности из кода и диффает с доками.
- **Один факт — одно место.** Инвентари (эндпоинты/env/таблицы/callbacks) — **канон в ARCHITECTURE**; QUICK_REF/SETUP только ссылаются или дают выжимку.
- **ADR** на неочевидные решения — `docs/decisions/` (Context / Decision / Consequences), коротко.
