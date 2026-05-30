# Swarm Brain — Quick Reference

> Читай этот файл в начале сессии. За деталями — [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Деплой

```bash
supabase functions deploy swarm-bot --no-verify-jwt          # всегда --no-verify-jwt
supabase functions deploy swarm-bot granola-poller --no-verify-jwt
supabase secrets set BOT_NAME=swarm-bot                       # env-переменные
```

**Ветка:** `sandbox_vas` — только здесь. В `main` не коммитить.

---

## Ключевые файлы

| Что менять | Файл |
|-----------|------|
| Команды бота, роутинг | `swarm-bot/index.ts` |
| Новый хендлер | `swarm-bot/handlers/<name>.ts` |
| Задачи (логика) | `swarm-bot/tasks/handlers.ts`, `tasks/db.ts` |
| Fuzzy assignee | `swarm-bot/tasks/matcher.ts` |
| Telegram helpers | `swarm-bot/lib/telegram.ts` |
| Сессии, доступ, saveEntry | `swarm-bot/lib/storage.ts` |
| Воркспейсы | `swarm-bot/lib/workspace.ts` |
| MCP инструменты | `swarm-mcp/index.ts`, `swarm-mcp/tasks/tools.ts` |
| ADMIN_USER_ID | `swarm-bot/lib/supabase.ts` → `744230399` |

---

## Callback-префиксы (не создавай новые без проверки)

| Префикс | Файл |
|---------|------|
| `gp_`, `gc_`, `gcp_`, `gd_`, `gedit_`, `gran_` | granola.ts |
| `mr_`, `mc_`, `medit_`, `mrename_`, `mtr_`, `mtag_`, `massign_`, `md_`, `met_`, `med_`, `rai_`, `meeting_`, `mau_`, `mexp_` | meetings.ts |
| `sa_` | superadmin.ts |
| `tk_` | tasks/handlers.ts |
| `fb_` | handlers/feedback.ts |

---

## Session action-префиксы (не создавай дубли)

| Префикс | Файл |
|---------|------|
| `waiting_add`, `waiting_ask` | index.ts |
| `granola_*` | granola.ts |
| `meeting_*` | meetings.ts |
| `feedback_text`, `feedback_photo` | feedback.ts |
| `task_*` | tasks/handlers.ts |
| `user_*` | users.ts |
| `sa_*` | superadmin.ts |

---

## Env-переменные

| Переменная | Обязательная |
|-----------|-------------|
| `TELEGRAM_BOT_TOKEN` | да |
| `SUPABASE_URL` | да |
| `SUPABASE_SERVICE_ROLE_KEY` | да |
| `OPENAI_API_KEY` | да |
| `BOT_NAME` | нет (дефолт `"bot"`) |

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

1. Обновить `ARCHITECTURE.md` (если поменялся флоу, таблица, callback, сессия)
2. Добавить запись в `CHANGELOG.md`
3. Закоммитить (`sandbox_vas`)
4. Задеплоить (`--no-verify-jwt`)
