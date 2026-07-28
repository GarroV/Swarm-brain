# Веб-вход через Google Sign-In (дизайн B)

> Статус: дизайн, утверждён владельцем 2026-07-29. Мотив: вход через Telegram-виджет неудобен и ловит баг pending-привязки (коллеги не могут залогиниться). Команда на Google Workspace `@dodobrands.io` → Google-вход = ноль трения. Google OAuth у нас **уже рабочий** (календарь рекордера, `google-oauth`) — переиспользуем креды.

## Решение (масштаб)
- **Лёгкий слой аутентификации сейчас, forward-compatible к уходу от Telegram потом** (владелец: «в теории уходим от Telegram, но не сейчас»).
- **Аутентификация:** Google Sign-In (OAuth `openid email profile`, `hd=dodobrands.io`). НЕ magic-link (не нужна почтовая инфра), НЕ Supabase Auth (тянет свою `auth.users` → трение).
- **Идентичность:** `telegram_id` остаётся ключом системы (задачи/уведомления/рекордер), но становится **опциональной привязкой**. Email — самостоятельный вход; email-only юзер (без `telegram_id`) существует и работает в вебе, Telegram привязывает позже.

## Ключевой принцип
Google отдаёт **верифицированный email** → находим/создаём `allowed_users` по email → выдаём нашу сессию `roj_session`. Всё downstream (`telegram_id`) — как есть; для email-only юзера сессия несёт `allowed_users.id` вместо `telegram_id`.

## Данные
- `allowed_users`: `telegram_id` уже nullable ✅. Добавить `email text` + **уникальный индекс `lower(email)`** (identity/access-таблица — email живёт здесь, не только в `user_profiles`). `id` (bigserial PK) — стабильный ключ для email-only.
- `user_profiles.email` — остаётся как отображаемое поле профиля; при заведении синхронизируется с `allowed_users.email`.

## Флоу входа
1. `/login` → кнопка «Войти через Google» (рядом с Telegram-виджетом; Telegram остаётся вторым способом).
2. → consent Google (`openid email profile`, `hd=dodobrands.io`, `state`=подписанный next).
3. Callback (edge-функция `google-login`, переиспользует `GOOGLE_CLIENT_ID/SECRET`): обмен кода → id_token/userinfo → **verified email + сверка домена = dodobrands.io** (серверно, не только `hd`).
4. Резолв доступа (политика ниже) → `allowed_users` строка → mint `roj_session` JWT (`telegram_id` ИЛИ `id`) → cookie `HttpOnly; Secure; SameSite=Lax` → редирект на `next`.

## Политика допуска (решение владельца 2026-07-29: ручной allowlist)
- **Никакого авто-допуска.** Админ ведёт список допущенных email вручную (команда мелкая — не проблема).
- Google-вход: verified email + сверка домена `dodobrands.io` → ищем `allowed_users` по email:
  - нашли + есть воркспейс → внутрь;
  - нашли, воркспейса нет → `403 No workspace assigned` (как сегодня);
  - **не нашли → «не допущен, попроси админа»** (не создаём строку).
- Домен `dodobrands.io` — второй гейт (даже если email случайно попал в allowlist иным).

## Привязка Telegram (опционально, для уведомлений/задач)
- Веб (email-сессия) → «Подключить Telegram» → генерим короткий код → `t.me/swarm_brain_bot?start=<код>` или отправка кода боту → бот привязывает `telegram_id` к строке. Включает: назначение задач, уведомления, рекордер-атрибуцию.
- Пока не привязан — веб работает, в бот не капает (мягкая деградация).

## Фазы (каждая раскатываема, прод-first, security-ревью)
- **Ф1 (данные):** `allowed_users.email` + уникальный индекс `lower(email)`. ADD-only, безопасно.
- **Ф2 (Google-login):** edge-функция `google-login` (/start + /callback), кнопка на `/login`. **Нужно:** добавить redirect URI логина в существующее OAuth-приложение Google Cloud.
- **Ф3 (авторезолв):** swarm-api резолвит юзера по JWT c `telegram_id` ИЛИ `allowed_users.id` (поддержка email-only). Трогает ядро auth — аккуратно + security-ревью.
- **Ф4 (привязка Telegram):** код через бот (`/start <код>`), эндпоинт подтверждения.
- **Ф5 (админка почт):** завести/править email, инвайты; синхронизация `allowed_users.email` ↔ `user_profiles.email`.

## Переиспользование существующего Google OAuth (`google-oauth`, календарь)
- **Одно и то же:** приложение Google Cloud + `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` + consent-screen — переиспользуем.
- **Разное:** флоу. Календарь берёт `calendar.events.readonly` у УЖЕ известного юзера (`state`=`telegram_id`), сохраняет refresh_token. Логин — минимальный `openid email profile`, УСТАНАВЛИВАЕТ личность, ничего не требует заранее.
- **Действие в Google Console:** добавить login-redirect `…/functions/v1/google-login/callback` в authorized redirect URIs того же приложения. Больше ничего.
- Синергия на будущее (не сейчас): при логине можно инкрементально запросить и календарь → подключение рекордера в один шаг. Пока держим раздельно (логин минимальный, календарь — отдельный opt-in).

## Безопасность
- Верифицировать `id_token` подписью Google (JWKS) ИЛИ userinfo по access-токену; **серверная сверка домена email = dodobrands.io** (не доверять только `hd`).
- `state` — подписанный JWT (уже так в `google-oauth`), защита CSRF; `next` — только same-origin (как в текущем telegram-callback).
- Cookie `HttpOnly; Secure; SameSite=Lax`.
- Привязка Telegram — только по одноразовому коду (нельзя присвоить чужой `telegram_id`).
- Auto-provision в pending без воркспейса → без данных до назначения админом.

## Открытые мелочи (не блокеры)
- Consent-screen Google: Internal (dodobrands.io) vs External — уточнить в Console (если Internal — домен и так закрыт).
- Убирать ли Telegram-виджет-вход позже (когда Google приживётся).
