-- Отметки «клиент реально обращался к серверу» для карточек интеграций в вебе (issue #921).
-- Только ADD COLUMN: безопасно накатывать до раскатки кода.
alter table public.allowed_users
  add column if not exists mcp_last_seen_at timestamptz,
  add column if not exists recorder_last_seen_at timestamptz;

comment on column public.allowed_users.mcp_last_seen_at is
  'Когда Claude Desktop (MCP-токен) последний раз успешно обратился к серверу. Пишет swarm-mcp и agent-auth через _shared/client-seen.ts, не чаще раза в 10 минут. null — ни разу.';
comment on column public.allowed_users.recorder_last_seen_at is
  'Когда рекордер встреч (токен рекордера) последний раз успешно обратился к серверу. Пишет agent-auth через _shared/client-seen.ts, не чаще раза в 10 минут. Не то же, что recorder_last_seen (heartbeat приложения для watchdog). null — ни разу.';
