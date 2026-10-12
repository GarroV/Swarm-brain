-- Журнал событий доступа (#797): кто и когда входил в веб, выпускал и отзывал токены.
-- Журналы платформы Supabase живут около недели, а дату выпуска бессрочного MCP-токена не
-- восстановить вовсе. Пишут только функции (service_role); секретов здесь нет — только факт,
-- канал и откуда пришёл запрос (best effort: заголовки, которые прислал прокси).
CREATE TABLE IF NOT EXISTS public.access_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  telegram_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'web_login',              -- новая сессия входа впервые пришла в swarm-api
    'web_access_exchanged',   -- личный токен обменян на 12-часовой веб-доступ (meeting-webtoken)
    'sessions_revoked',       -- «выйти везде»
    'mcp_token_issued',
    'mcp_token_revoked',
    'recorder_token_issued',
    'recorder_token_revoked'
  )),
  via text NOT NULL,          -- канал: web, bot, recorder, preview, …
  ip text,                    -- сырая цепочка x-forwarded-for | cf-connecting-ip, не доказательство
  country text,
  -- Момент входа сессии (секунды) — только у web_login: по нему одна сессия = одна запись.
  session_auth_time bigint
);

CREATE INDEX IF NOT EXISTS access_events_user_at ON public.access_events (telegram_id, at DESC);
CREATE INDEX IF NOT EXISTS access_events_at ON public.access_events (at DESC);
-- Одна сессия = одна запись о входе. Индекс без условия, чтобы его видел ON CONFLICT
-- (PostgREST upsert); у прочих событий session_auth_time пуст, а NULL уникальности не мешает.
CREATE UNIQUE INDEX IF NOT EXISTS access_events_one_login_per_session
  ON public.access_events (telegram_id, session_auth_time);

-- Внешний замок, как у всех таблиц public: RLS без политик, читают и пишут только функции.
ALTER TABLE public.access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_events FROM anon, authenticated;
