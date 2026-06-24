# Swarm Brain — Развёртывание с нуля

Это пошаговая инструкция для поднятия полной копии проекта на новой инфраструктуре.

---

## Что понадобится

| Ресурс | Где получить |
|--------|-------------|
| Supabase аккаунт | https://supabase.com |
| Telegram Bot Token | @BotFather в Telegram |
| OpenAI API Key | https://platform.openai.com/api-keys |
| Cloudflare Pages (опционально) | https://pages.cloudflare.com — для Mini App |

---

## Шаг 1 — Supabase: создать проект

1. Создай новый проект на https://supabase.com
2. Запомни: **Project URL** и **service_role key** (Settings → API)

---

## Шаг 2 — Схема БД

В SQL Editor проекта выполни файл:

```
supabase/migrations/00000000_initial_schema.sql
```

Это создаёт все таблицы, индексы, функции, RLS и расширения (`vector`, `pgcrypto`).

После этого примени остальные миграции из `supabase/migrations/` в порядке по имени файла (они идут с датами, хронологически).

---

## Шаг 3 — Storage: создать bucket

В Supabase Dashboard → Storage → New bucket:

- **Name:** `swarm_drive`
- **Public:** ✅ да (файлы отдаются по публичным URL)

---

## Шаг 4 — Telegram Bot

1. Найди @BotFather → `/newbot` → получи `BOT_TOKEN`
2. Webhook настроится автоматически при первом деплое (см. Шаг 7)

---

## Шаг 5 — Код: поменять ADMIN_USER_ID

В файле `supabase/functions/swarm-bot/lib/supabase.ts`:

```ts
export const ADMIN_USER_ID = 744230399; // ← заменить на свой Telegram ID
```

Найди свой ID через @userinfobot в Telegram.

---

## Шаг 6 — Установить Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

`<YOUR_PROJECT_REF>` — 20-значный ID из URL проекта (вида `abcdefghijklmnopqrst`); подставь его во все команды и URL ниже.

> Прод-реф Dodo Brands — `vbqglndbxkpmreccpqmr` (используй его вместо `<YOUR_PROJECT_REF>` при работе с продакшеном).

---

## Шаг 7 — Secrets (переменные окружения)

### 7.1 Базовые секреты (обязательны для работы бота)

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=<token>
supabase secrets set OPENAI_API_KEY=<key>
supabase secrets set CRON_SECRET=<любая_случайная_строка>
supabase secrets set MINIAPP_ORIGIN=<URL_минипрложения_или_*>
```

| Secret | Описание | Обязателен |
|--------|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather | ✅ |
| `OPENAI_API_KEY` | Ключ OpenAI | ✅ |
| `CRON_SECRET` | Любая строка — защищает cron-эндпоинты | ✅ |
| `MINIAPP_ORIGIN` | URL Mini App (для CORS). Используй `*` для начала | рекомендуется |
| `INITDATA_MAX_AGE` | Срок жизни initData Telegram в секундах (по умолчанию 86400) | опционально |
| `BOT_NAME` | Имя бота в подписи фидбека (по умолчанию `bot`) | опционально |
| `MCP_AUTH_REQUIRED` | `true` — строгая авторизация в swarm-mcp (по умолчанию soft) | опционально |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Edge Functions получают автоматически — вручную устанавливать не нужно.

### 7.2 Веб / Mini App auth (нужно, если используешь веб-логин и связку Google)

```bash
supabase secrets set WEB_JWT_SECRET=<любая_длинная_случайная_строка>
supabase secrets set WEB_BASE_URL=<URL_веб-фронтенда_или_Mini_App>
```

| Secret | Описание | Обязателен |
|--------|----------|-----------|
| `WEB_JWT_SECRET` | Секрет подписи веб-сессий (Login Widget, Bearer-токены swarm-api, OAuth-state Google). Без него веб-логин и `/google/connect-url` отдают 500 | нужен для веб-логина и Google-connect |
| `WEB_BASE_URL` | Базовый URL веб-фронтенда — используется в ссылках на встречи (`meeting-ingest`) и редиректах после Google OAuth | нужен для веб-ссылок и Google OAuth |

### 7.3 Google Drive (опционально — только если включён аплоад файлов в Drive)

Сервис-аккаунт Google используется ботом для загрузки файлов (`swarm-bot/lib/drive.ts`).

```bash
supabase secrets set GOOGLE_CLIENT_EMAIL=<service-account-email>
supabase secrets set GOOGLE_PRIVATE_KEY="<private-key-с-\n>"
supabase secrets set GOOGLE_DRIVE_FOLDER_ID=<id-корневой-папки>
```

OAuth-флоу подключения личного Google-аккаунта (`google-oauth`, `meeting-current`) дополнительно требует:

```bash
supabase secrets set GOOGLE_CLIENT_ID=<oauth-client-id>
supabase secrets set GOOGLE_CLIENT_SECRET=<oauth-client-secret>
```

| Secret | Описание | Обязателен |
|--------|----------|-----------|
| `GOOGLE_CLIENT_EMAIL` | Email сервис-аккаунта Google (JWT `iss` для Drive) | опционально (только Drive-аплоад) |
| `GOOGLE_PRIVATE_KEY` | Приватный ключ сервис-аккаунта (с `\n`) | опционально (только Drive-аплоад) |
| `GOOGLE_DRIVE_FOLDER_ID` | ID корневой папки Drive для загрузок | опционально (только Drive-аплоад) |
| `GOOGLE_CLIENT_ID` | OAuth client ID для подключения личного Google-аккаунта | опционально (только Google OAuth) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | опционально (только Google OAuth) |

### 7.4 Read.ai (опционально — только если используешь интеграцию Read.ai)

```bash
supabase secrets set READ_AI_CLIENT_ID=<read-ai-client-id>
supabase secrets set READ_AI_WEBHOOK_SECRET=<webhook-secret>
```

| Secret | Описание | Обязателен |
|--------|----------|-----------|
| `READ_AI_CLIENT_ID` | Client ID Read.ai для OAuth-подключения (`read-ai-auth`) | опционально (только Read.ai) |
| `READ_AI_WEBHOOK_SECRET` | Секрет проверки вебхуков Read.ai (`read-ai-webhook`) | опционально (только Read.ai) |

---

## Шаг 8 — Задеплоить Edge Functions

```bash
supabase functions deploy swarm-bot       --no-verify-jwt
supabase functions deploy swarm-api        --no-verify-jwt
supabase functions deploy swarm-mcp        --no-verify-jwt
supabase functions deploy swarm-setup      --no-verify-jwt
supabase functions deploy read-ai-webhook  --no-verify-jwt
supabase functions deploy read-ai-auth     --no-verify-jwt   # только если используешь Read.ai
supabase functions deploy google-oauth     --no-verify-jwt   # только если используешь Google OAuth
supabase functions deploy meeting-ingest   --no-verify-jwt   # только если используешь встречи (Read.ai/Granola → встречи)
supabase functions deploy meeting-current  --no-verify-jwt   # только если используешь встречи
supabase functions deploy meeting-claim    --no-verify-jwt   # только если используешь встречи
```

> **⚠️ НЕ деплоить `granola-poller` — это LEGACY.** Standalone-функция `granola-poller` выведена из эксплуатации: НЕ запускай `supabase functions deploy granola-poller`. Поллинг Granola теперь работает **внутри `swarm-bot`** через ежечасный cron (см. Шаг 12, тело `{"granola_poll":true}`). Директория ещё лежит в репозитории, но деплоить её не нужно и нельзя — она ни на что не подписана.

> **Важно:** `--no-verify-jwt` обязателен для всех функций, иначе Telegram-webhook и внешние коллбэки получают 401.

---

## Шаг 9 — Зарегистрировать Telegram webhook

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/swarm-bot"}'
```

Проверить:
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

---

## Шаг 10 — Начальная настройка

### 10.1 Зарегистрировать команды бота

```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/swarm-bot" \
  -H "Content-Type: application/json" \
  -H "X-Cron-Secret: <CRON_SECRET>" \
  -d '{"setup_commands": true}'
```

### 10.2 Создать воркспейс

В Supabase SQL Editor:

```sql
INSERT INTO workspaces (id, name) VALUES ('my-team', 'My Team');
```

### 10.3 Добавить первого пользователя (себя)

```sql
INSERT INTO allowed_users (telegram_id, username, added_by, is_admin, group_id)
VALUES (<твой_telegram_id>, '<username>', <твой_telegram_id>, true, 'my-team');
```

После этого напиши `/start` боту — он тебя узнает.

### 10.4 Настроить канал для фидбека (опционально)

Создай Telegram-канал или группу, добавь бота как администратора, и запиши ID в настройки:

```sql
INSERT INTO app_settings (key, value)
VALUES ('feedback_channel_id', '"<CHAT_ID>"');
-- Chat ID группы или канала (со знаком минус для групп, например "-100123456789")
```

---

## Шаг 11 — Mini App (опционально)

1. Переименуй `.env.local.example` → `.env.local` в папке `miniapp/`:

```env
NEXT_PUBLIC_API_URL=https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/swarm-api
NEXT_PUBLIC_DEV_MODE=false
```

2. Собери и задеплой:

```bash
cd miniapp
npm install
npm run build
# Содержимое out/ → задеплоить на Cloudflare Pages или любой статик-хостинг
```

3. В @BotFather настрой Mini App: `/newapp` → укажи URL деплоя.

4. Обнови `MINIAPP_ORIGIN` в secrets на реальный URL.

---

## Шаг 12 — Настройка cron-jobs (опционально)

Для автоматического дайджеста и поллинга Granola настрой cron через Supabase Dashboard → Edge Functions → Schedule или через pg_cron:

```sql
-- Дайджест каждый понедельник в 9:00 UTC
select cron.schedule(
  'weekly-digest',
  '0 9 * * 1',
  $$
    select net.http_post(
      url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/swarm-bot',
      headers := '{"Content-Type":"application/json","X-Cron-Secret":"<CRON_SECRET>"}',
      body := '{"digest_cron":true}'
    );
  $$
);

-- Поллинг Granola каждый час — бьёт в swarm-bot, а не в standalone granola-poller
-- (granola-poller устарел; вся логика импорта живёт в swarm-bot → ingestNewGranolaNotesAllUsers)
select cron.schedule(
  'granola-poll',
  '0 * * * *',
  $$
    select net.http_post(
      url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/swarm-bot',
      headers := '{"Content-Type":"application/json","X-Cron-Secret":"<CRON_SECRET>"}',
      body := '{"granola_poll":true}'
    );
  $$
);
```

> Для pg_cron требуется расширение `pg_net`. Включить в Supabase Dashboard → Database → Extensions.

---

## Структура таблиц БД

| Таблица | Назначение |
|---------|-----------|
| `workspaces` | Тенанты/команды. `id` — короткий slug (например `cee`) |
| `allowed_users` | Белый список. Пользователь видит бота только если здесь есть строка |
| `user_profiles` | Имя, роль, рынки, алиасы. Создаётся автоматически при первом /start |
| `entries` | Все записи базы знаний. `is_private=true` + `owner_id` — личное хранилище |
| `tasks` | Командные задачи. `group_id` привязывает к воркспейсу |
| `task_history` | История изменений задач |
| `task_comments` | Комментарии к задачам |
| `sessions` | Активные диалоги бота. TTL 30 мин через `updated_at` |
| `feedback` | Фидбек от пользователей |
| `app_settings` | Глобальные настройки (key=value). `feedback_channel_id` — обязательно |
| `oauth_tokens` | OAuth-токены Read.ai |
| `oauth_state` | Временные state для OAuth flow |
| `user_integrations` | API-ключи Granola per user |

---

## Часто задаваемые вопросы

**Бот не отвечает:**
- Проверь webhook: `getWebhookInfo` — должен показывать твой URL без ошибок
- Проверь логи: Supabase Dashboard → Edge Functions → swarm-bot → Logs

**Ошибка 401 при запросах от Telegram:**
- Убедись что деплой сделан с `--no-verify-jwt`

**Cron не запускается:**
- Проверь что `CRON_SECRET` в headers совпадает с secrets
- Включи расширение `pg_net` для HTTP-запросов из pg_cron

**Mini App не открывается:**
- Проверь `MINIAPP_ORIGIN` в secrets — должен совпадать с URL деплоя
- В режиме разработки используй `NEXT_PUBLIC_DEV_MODE=true`
