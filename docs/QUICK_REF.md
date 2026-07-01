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
supabase functions deploy meeting-webtoken --no-verify-jwt   # обмен recorder-токена на web-JWT (cookie roj_session) для панели /live в WKWebView рекордера
# granola-poller — legacy, НЕ деплоить: поллинг Granola внутри swarm-bot ({granola_poll:true} крон)
supabase secrets set BOT_NAME=swarm-bot                       # env-переменные
```

> **`--no-verify-jwt` теперь ЗАКРЕПЛЁН в `supabase/config.toml`** (`[functions.<name>] verify_jwt = false` для всех 15 функций). Флаг в командах выше — подстраховка, конфиг и так делает функции публичными на шлюзе. **Не ставь `verify_jwt = true`** ни одной функции: рекордер/вебхуки/бот шлют не-JWT `Bearer`-токены и делают свою авторизацию в коде → шлюз с verify_jwt отобьёт их 401 `INVALID_JWT_FORMAT` ещё до функции (так в 2026-06-30 молча падали ВСЕ загрузки рекордера — разбор в BACKLOG).

### Веб (miniapp) — Cloudflare Pages, АВТО (руками НЕ деплоить)

> Проверено 2026-06-28 через CF API. Веб «Рой» выкатывается **сам** на каждый push в `sandbox_vas` — отдельный ручной шаг НЕ нужен (в отличие от edge-функций выше).

- **Проект:** `swarm-brain` → `https://swarm-brain.pages.dev`, git-привязка к `GarroV/Swarm-brain`, **production branch = `sandbox_vas`**.
- **Build:** root dir `miniapp`, command `npm run build`, output `out`. Pages Functions из `miniapp/functions/` (прокси авторизации `/api/*`) деплоятся вместе.
- **Цикл:** push в `sandbox_vas` → авто-сборка CF → прод за ~1–3 мин (проверено: последние деплои `deploy/success`).
- **Env** (живут в дашборде CF Pages → Settings → Variables, НЕ в репо): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BOT_USERNAME`, `NEXT_PUBLIC_DEV_MODE`, `SWARM_API_URL`, `TELEGRAM_BOT_TOKEN`, `WEB_JWT_SECRET`.
- Конфиг живёт **только в дашборде CF** (в репо нет `wrangler`/`.github/workflows` — и не нужно, git-интеграция сама собирает).
- **Нюанс URL:** CF Pages срезает `.html` → `/foo.html` отдаёт 308 на `/foo` (напр. `/system-map.html` → `/system-map`). Ссылки лучше без `.html`.
- **«В проде старая версия»?** Это НЕ деплой (он работает), а залипший клиентский **service worker / PWA-кэш** → ⌘⇧R / Unregister SW / перезапуск PWA. См. `BACKLOG.md` → «Веб (miniapp): деплой РАБОТАЕТ».

**Ветка:** `sandbox_vas` — только здесь. В `main` не коммитить.

---

## 🧭 Навигационный индекс — «где что» (канон, ищи здесь первым)

> Цель: найти файл за секунды, не перечитывая репо. `§` = раздел в [ARCHITECTURE.md](ARCHITECTURE.md); spoke = отдельный док.

### Бот (Telegram) — `swarm-bot/`
| Concern | Файлы | Детали |
|---|---|---|
| Команды, роутинг входящего (сохранить vs искать) | `swarm-bot/index.ts`, `lib/intent.ts` | §swarm-bot, §Роутинг входящего |
| Сохранение записи (saveEntry/индекс), сессии, доступ | `swarm-bot/lib/storage.ts` | §Флоу сохранения, §Сессионный механизм |
| Правка/удаление записей из чата | `swarm-bot/handlers/manage.ts` | §Управление записями |
| Воркспейсы | `swarm-bot/lib/workspace.ts` | §Воркспейсы |
| Telegram helpers / новый хендлер | `swarm-bot/lib/telegram.ts`, `handlers/<name>.ts` | §swarm-bot |
| `ADMIN_USER_ID` (зашит) | `swarm-bot/lib/supabase.ts` → `744230399` | §Контроль доступа |

### Mini App backend — `swarm-api/`
| Concern | Файлы | Детали |
|---|---|---|
| Все HTTP-эндпоинты (задачи/entries/встречи/поиск/дайджест) | `swarm-api/index.ts` | §swarm-api (канон эндпоинтов) |
| **Доступ к `entries`** (приватность+воркспейс) — НЕ грепать напрямую | `swarm-api/entries-guard.ts` | §Контроль доступа |
| Админка (воркспейсы/бродкаст/профили) | `swarm-api/admin.ts` | §swarm-api |
| Auth (initData / agent-токен / web-JWT) | `swarm-api/auth.ts`, `_shared/agent-auth.ts`, `_shared/jwt.ts` | §MCP-аутентификация |

### Задачи (общий движок) — `_shared/tasks/`
| Concern | Файлы | Детали |
|---|---|---|
| CRUD/спринты/зависимости/типы | `_shared/tasks/{db,sprints,dependencies,types}.ts` | spoke [SHARED_TASKS_ENGINE.md](SHARED_TASKS_ENGINE.md) |
| Бот-обёртка / MCP-прослойка / fuzzy-assignee | `swarm-bot/tasks/{db,handlers,matcher}.ts`, `swarm-mcp/tasks/tools.ts` | §Движок задач |

### Поиск / записи / страны
| Concern | Файлы | Детали |
|---|---|---|
| RAG / семантический поиск / matchEntries | `_shared/search.ts` (+ `swarm-api` `/search`,`/ask`,`/digest`) | §swarm-api |
| Классификация стран | `_shared/countries.ts` | §Флоу сохранения |

### Встречи — запись → транскрибация → тезисы → ревью
| Concern | Файлы | Детали |
|---|---|---|
| Durable-обработка (транскрибация по куску) | `_shared/meeting-processor.ts`, `meeting-ingest/`, `meeting-process/` (cron); watchdog `swarm-bot/index.ts` `sweepStuckMeetings` | §Флоу встреч |
| Промпт тезисов (канон, DRY) | `_shared/tezisy-prompt.ts` | §Флоу встреч |
| Ревью/правка/публикация/переобработка | `swarm-api` (`/agent-meetings*`,`/meetings*`), `miniapp .../screens/MeetAdminScreen.tsx`,`MeetingDetail.tsx` | §swarm-api, spoke [MINIAPP_ARCHITECTURE.md](MINIAPP_ARCHITECTURE.md) |
| Granola импорт / Read.ai / статус-бэкап | `swarm-bot/handlers/granola.ts`, `read-ai-webhook/`, `meeting-status/` | §Флоу встреч |
| Дедуп встреч (кросс-источниковый: Granola/рекордер/Read.ai) | `_shared/meeting-dedup.ts` (+ `.test.ts`); применён в `granola.ts`, `swarm-api` (publish/import), `read-ai-webhook/` | §Флоу встреч → Дедуп встреч |
| Календарь / участники (только календарные встречи; аудио-диаризации нет) | `meeting-current/`, `google-oauth/`, рекордер `MeetingIdentity.swift` | §Флоу встреч |

### Рекордер (macOS, Swift) — `recorder/`
| Concern | Файлы | Детали |
|---|---|---|
| Жизненный цикл/виджет/аплоад/нарезка/бэкап | `recorder/Sources/SwarmRecorder/**` (`AppDelegate`,`RecorderWidget`,`UploadQueue`,`Segmenter`,`SwarmClient`) | spoke [recorder/README.md](../recorder/README.md) |
| Релиз новой сборки (тег `recorder-build-N`) | `swarm-recorder-version/index.ts` (`LATEST_BUILD`) | recorder/README.md (runbook) |

### Frontend «Рой» (Mini App) — `miniapp/src/components/roy/`
| Concern | Файлы | Детали |
|---|---|---|
| Экраны/панели/дизайн-система/навигация | `miniapp/src/components/roy/**` (app/layout/screens); переиспользуемые компоненты задач — `miniapp/src/components/tasks/**` (напр. `TaskRow.tsx`) | spoke [MINIAPP_ARCHITECTURE.md](MINIAPP_ARCHITECTURE.md) |
| API-клиент / типы | `miniapp/src/lib/api.ts`, `miniapp/src/types.ts` | MINIAPP_ARCHITECTURE.md |

### MCP / установщики
| Concern | Файлы | Детали |
|---|---|---|
| MCP-инструменты (Claude Desktop) | `swarm-mcp/index.ts`, `swarm-mcp/tasks/tools.ts` | §swarm-mcp |
| Авто-сетап Claude Desktop (`/setup`) | `swarm-setup/script.ts`, `swarm-bot/lib/mcp-setup.ts` | §swarm-mcp |
| Установка рекордера (`/recordertoken`) | `swarm-recorder-setup/script.ts`, `recorder/setup-signing.sh`, `swarm-bot/lib/mcp-setup.ts` | recorder/README.md |

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
| `mr_`, `mc_`, `medit_`, `mrename_`, `mtr_`, `mtag_`, `massign_`, `md_`, `met_`, `med_`, `rai_`, `meeting_`, `mau_`, `mexp_` | meetings.ts |
| `sa_` | superadmin.ts |
| `tk_` | tasks/handlers.ts |
| `fb_` | handlers/feedback.ts |
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
| `feedback_text`, `feedback_photo` | feedback.ts |
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
4. Закоммитить (`sandbox_vas`) + сразу `git push`.
5. Задеплоить (`--no-verify-jwt`).
6. **Проверить, что не отвалилось** (принцип №2): `deno check` + смоук реального флоу; что не проверил — сказать прямо.

---

## Доки — держать живыми (на поток)

- **🧭 Индекс выше — единый вход.** Меняешь подсистему → проверь, что её строка в индексе и инвентарь в ARCHITECTURE актуальны (тем же коммитом — часть DoD).
- **Инвентари сверяй скриптом, не глазами:** `./scripts/doc-inventory.sh [endpoints|env|functions|tables|callbacks]` печатает факты ИЗ КОДА → сверь с таблицами в ARCHITECTURE. Расхождение = дрифт (код не задокументирован / дока устарела).
- **Перед крупным мёржем или раз в квартал** — drift-аудит скиллом `keeping-docs-current` (`~/.claude/skills/keeping-docs-current/drift-audit.workflow.js`): перечисляет публичные поверхности из кода и диффает с доками.
- **Один факт — одно место.** Инвентари (эндпоинты/env/таблицы/callbacks) — **канон в ARCHITECTURE**; QUICK_REF/SETUP только ссылаются или дают выжимку.
- **ADR** на неочевидные решения — `docs/decisions/` (Context / Decision / Consequences), коротко.
