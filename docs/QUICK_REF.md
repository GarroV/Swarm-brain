# Swarm Brain — Quick Reference

> Читай этот файл в начале сессии. За деталями — [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Деплой

```bash
supabase functions deploy swarm-bot --no-verify-jwt          # всегда --no-verify-jwt
supabase functions deploy swarm-setup --no-verify-jwt        # публичный GET, Claude Desktop installer
supabase functions deploy swarm-recorder-setup --no-verify-jwt  # публичный GET, установщик рекордера (/recordertoken)
# granola-poller — legacy, НЕ деплоить: поллинг Granola внутри swarm-bot ({granola_poll:true} крон)
supabase secrets set BOT_NAME=swarm-bot                       # env-переменные
```

**Ветка:** `sandbox_vas` — только здесь. В `main` не коммитить.

---

## Ключевые файлы

| Что менять | Файл |
|-----------|------|
| Команды бота, роутинг | `swarm-bot/index.ts` |
| Правка/удаление записей из чата | `swarm-bot/handlers/manage.ts` |
| Классификатор намерения (удали/замени/url) | `swarm-bot/lib/intent.ts` |
| Новый хендлер | `swarm-bot/handlers/<name>.ts` |
| Задачи (движок, общий) | `_shared/tasks/db.ts`, `_shared/tasks/types.ts` |
| Задачи (бот-обёртка) | `swarm-bot/tasks/db.ts`, `swarm-bot/tasks/handlers.ts` |
| Задачи (MCP-прослойка) | `swarm-mcp/tasks/tools.ts` |
| Fuzzy assignee | `swarm-bot/tasks/matcher.ts` |
| Telegram helpers | `swarm-bot/lib/telegram.ts` |
| Сессии, доступ, saveEntry | `swarm-bot/lib/storage.ts` |
| Воркспейсы | `swarm-bot/lib/workspace.ts` |
| MCP инструменты | `swarm-mcp/index.ts`, `swarm-mcp/tasks/tools.ts` |
| Авто-сетап Claude Desktop (`/setup`) | `swarm-setup/script.ts` (bash), `swarm-bot/lib/mcp-setup.ts` (минт токена) |
| Установка рекордера (`/recordertoken`) | `swarm-recorder-setup/script.ts` (bash), `recorder/setup-signing.sh` (cert), `recorder/install.sh`, `swarm-bot/lib/mcp-setup.ts` (`mintRecorderToken`) |
| ADMIN_USER_ID | `swarm-bot/lib/supabase.ts` → `744230399` |

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
