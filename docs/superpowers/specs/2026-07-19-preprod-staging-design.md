# Спека: пред-прод / staging (гибрид по поверхностям, substrate = MUSPELHEIM)

> Статус: дизайн утверждён (2026-07-19). Реализация впереди. Substrate — self-hosted Supabase на домашнем сервере MUSPELHEIM (по Tailscale, приватно, personal-use, «костыли ок»). Локалка `supabase start` — быстрый inner-loop + фолбэк.

## Проблема
Всё катится **сразу в прод**, пред-прода нет (кроме web и рекордера). За сессию 17–19.07 этим кусало: stale-bundle (`meeting-current` 401 молча), MCP strict-флип (риск сломать коннекторы), миграции — на живых данных, team-wide рекордер-раскатка без обкатки. Проект дорос до пред-прод-контура.

## Принцип: пред-прод ПО ПОВЕРХНОСТЯМ (не один монолит)
Каждая поверхность имеет свой риск и свою готовность:

| Поверхность | Риск | Пред-прод |
|---|---|---|
| Edge-функции | средний | **локалка `functions serve` + staging (MUSPELHEIM)** |
| БД / миграции | **высокий (данные)** | **`supabase db reset` локально + накат на staging** |
| Бот / MCP | средний | локалка + **синтетический апдейт curl'ом**; реальный round-trip → тест-бот long-polling |
| Web (miniapp) | низкий | **CF preview на ветку — уже есть** ✅ |
| Рекордер (Swift) | высокий (вся команда) | **staged rollout — уже есть** ✅ (локал-сборка → тег → `LATEST_BUILD`-гейт) |

## Substrate: self-hosted Supabase на MUSPELHEIM
- Официальный `supabase/docker` compose: Postgres+pgvector+pg_cron, Edge-runtime, Storage, Auth, Studio. Даёт **постоянный prod-подобный контур** (лучше эфемерной локалки).
- Приватный — только по **Tailscale** (`ssh muspelheim`). Для смоука (я/владелец curl'ом по tailnet) этого достаточно; публичный вход НЕ нужен (личное использование). Бот-round-trip при желании — **long-polling** (MUSPELHEIM ровно под это заточен), не webhook.
- Конфиг staging живёт в репо **`muspelheim-infra`** (`C:\projects\swarm-staging` из `_template`), НЕ в этом репо.
- **Локалка (`supabase start` на Маке)** — самый быстрый inner-loop + фолбэк, если MUSPELHEIM не потянет по RAM.
- Разрешено как **тест-исключение** из глобального правила «Swarm — в облаке, на MUSPELHEIM не разворачивать» (владелец подтвердил 2026-07-19; это staging, не прод).

## Рабочий цикл (конкретно)

**Edge-функция (напр. правка авторизации типа MCP-strict):**
```
1. правка кода + deno check
2. supabase functions serve <fn>            # локально против локальной БД
3. смоук локально: тот же curl, что гоняли бы на проде (напр. без токена → 401, с токеном → ответ)
4. локально ок → накат на staging (MUSPELHEIM) → тот же смоук по Tailscale
5. staging ок → deploy на прод → тот же смоук на проде
```

**Миграция БД:**
```
1. пишу миграцию
2. supabase db reset                         # накатывает ВСЕ миграции на чистую локальную БД → SQL-поломки ловятся тут
3. смотрю схему в Studio (localhost)
4. накат на staging (MUSPELHEIM) поверх staging-данных → проверка что не рушит существующее
5. staging ок → накат на прод
```

**Бот/MCP:** `functions serve` + `curl` синтетического Telegram-апдейта (роутинг/хендлеры/эффекты в БД, без туннеля). Реальный round-trip — тест-бот long-polling на staging.

## Обвязка (в этом репо)
- `Makefile`: `make local` (start+serve), `make staging-deploy`, `make staging-smoke`, `make prod`, `make prod-smoke`.
- Смоук-скрипты (`scripts/smoke/*.sh`) — curl ключевых эндпоинтов, переиспользуемы для local/staging/prod (параметр — base URL).
- `docs/DEPLOY.md` — чек-лист «что гонять перед продом по каждой поверхности».
- Роль Claude: поднимаю serve, гоняю смоук локально→staging→прод, докладываю; владелец жмёт «прод» после зелёного staging.

## Риски / открытые
- **MUSPELHEIM — ноут-сервер:** батарея=UPS, ребут = физлогин, Docker страхуется watchdog'ом. Для staging приемлемо (может иногда лежать), для прода — нет.
- **Ёмкость:** self-hosted Supabase ~10 контейнеров + существующие боты. **Проверить RAM (Step 0)**; не тянет → фолбэк на локалку. (На момент написания sshd MUSPELHEIM не отвечал — пинг ок, порт 22 таймаут.)
- **self-hosted ≠ cloud Supabase:** мелкие различия (некоторые managed-фичи, версии). Staging ≈ прод, не идентичен — прод-конфиг всё равно смоукаем после деплоя.
- **Секреты staging:** свои тест-ключи (OpenAI/Google/Telegram) или те же — решить при настройке.

## Шаги реализации
0. **Проверить MUSPELHEIM** (RAM/Docker свободны под стек). Не тянет → substrate = только локалка, остальное без изменений.
1. Поднять self-hosted Supabase на MUSPELHEIM (`supabase/docker` compose), конфиг в `muspelheim-infra`.
2. Накатить схему + миграции на staging (`00_base_schema.sql` + `supabase/migrations/`).
3. Секреты staging.
4. Смоук-скрипты (параметризованы base-URL) + `Makefile` + `docs/DEPLOY.md`.
5. Прогнать одно реальное изменение через полный цикл — проверка, что процесс работает.

## Не входит (YAGNI)
- CI/GitHub Actions — solo-dev, оверкилл (можно добавить позже).
- Публичный вход для Telegram-webhook/CF на staging — личное использование, Tailscale хватает.
- Прод на MUSPELHEIM — только staging.
