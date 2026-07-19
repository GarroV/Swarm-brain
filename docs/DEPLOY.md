# DEPLOY — пред-прод и раскатка (по поверхностям)

> Дизайн: [specs/2026-07-19-preprod-staging-design.md](superpowers/specs/2026-07-19-preprod-staging-design.md). Принцип — пред-прод **по поверхностям** (не один монолит): у каждой свой контур по риску.

## Контуры

| Контур | Что | Base URL функций | БД |
|---|---|---|---|
| **local** | `supabase start` на Маке (Docker) | `http://127.0.0.1:54321/functions/v1` | локальный |
| **staging** | self-hosted Supabase на **MUSPELHEIM** (Tailscale, приватно) | `http://100.64.116.67:8020/functions/v1` | `100.64.116.67:5433` |
| **prod** | Supabase cloud `vbqglndbxkpmreccpqmr` | `https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1` | cloud |

Staging использует **демо-ключи** Supabase (ANON/SERVICE/JWT из `.env.example`) — ок, т.к. контур приватный (только tailnet, личное использование). Порты сдвинуты (kong `8020`, БД `5433`), чтобы не конфликтовать с n8n/template-postgres на MUSPELHEIM.

## Поток по поверхностям

| Поверхность | Пред-прод |
|---|---|
| Edge-функции | `supabase functions serve` локально → `make staging-sync-functions` + `make smoke-staging` → прод + `make smoke-prod` |
| БД / миграции | `supabase db reset` локально → `make staging-migrate FILE=…` → прод |
| Бот / MCP | локалка + curl синтетического апдейта; strict/тулзы — `make smoke-staging` |
| Web (miniapp) | CF preview на ветку (авто) → мёрж в `sandbox_vas` |
| Рекордер | локал-сборка → тег `recorder-build-N` → `LATEST_BUILD`-гейт (см. `recorder/README.md`) |

## Рабочий цикл (edge + миграция)

```bash
# edge-функция
supabase functions serve <fn>            # 1. локально против локальной БД
#    смоук локально (curl localhost)      # 2. вижу поведение
make staging-sync-functions              # 3. залить на staging + рестарт edge-runtime
make smoke-staging                       # 4. смоук на staging (по tailnet)
supabase functions deploy <fn> --no-verify-jwt   # 5. прод
make smoke-prod                          # 6. смоук на проде

# миграция БД
supabase db reset                        # 1. накат ВСЕХ миграций на чистую локальную БД (ловит SQL-поломки)
make staging-migrate FILE=supabase/migrations/2026….sql   # 2. на staging поверх staging-данных
#    (ок) → накат на прод
```

## Команды (`make help`)
- `make smoke-staging` / `make smoke-prod` — смоук edge-функций (`scripts/smoke.sh`, один и тот же набор проверок для любого контура).
- `make staging-sync-functions` — tar `supabase/functions` → scp на MUSPELHEIM → распаковка в `volumes/functions/` → рестарт `supabase-edge-functions`.
- `make staging-migrate FILE=…` — накатить SQL-файл на staging-БД (`ON_ERROR_STOP`).
- `make staging-psql` — psql в staging-БД (стдин). `make staging-ps/-up/-down` — статус/подъём/останов стека.

## Staging на MUSPELHEIM — устройство
- `C:\projects\swarm-staging` — официальный `supabase/docker` compose. 11 контейнеров (db, kong, rest, auth, storage, edge-functions, realtime, studio, meta, pooler, imgproxy).
- Функции — в `volumes/functions/` (роутер `main` отдаёт соседние папки под `/functions/v1/<name>`). `_shared` рядом.
- Studio: `http://100.64.116.67:8020` (kong), логин из `.env` (`DASHBOARD_USERNAME/PASSWORD`).

### ⚠️ Секреты staging — TODO (нужны твои тестовые ключи)
Функции, которым нужны внешние API, на staging пока НЕ отработают без ключей. `SUPABASE_URL`/`SERVICE_ROLE_KEY`/`ANON_KEY` compose проставляет сам; добавить в env сервиса `functions` (через `docker-compose.override.yml` в `swarm-staging`): `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN` (тест-бот!), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `WEB_JWT_SECRET`. `MCP_AUTH_REQUIRED=true` — выставлено (зеркалит прод). Логика/БД/auth тестируются и без внешних ключей.

### Квирки MUSPELHEIM
- Ноут-сервер: батарея=UPS, ребут = физлогин, Docker страхует watchdog. Для staging ок (может иногда лежать).
- **sshd залипает** (было 19.07: пинг ок, порт 22 без баннера) → на машине `Restart-Service sshd` (RDP/физически) или ребут `shutdown /g`. Завести авто-рестарт sshd в `muspelheim-infra`.
- Конфиг staging (compose + `.env`-шаблон) — **версионировать в `muspelheim-infra`** по конвенции (пока живёт только на диске сервера).

## Не входит (YAGNI)
CI/GitHub Actions (solo-dev); публичный вход для Telegram-webhook/CF на staging (Tailscale хватает); прод на MUSPELHEIM (только staging).
