-- «Выйти везде»: отметка, до которой веб-сессии человека считаются отозванными.
-- swarm-api отклоняет сессию, чей момент входа (auth_time) раньше этой отметки; выход
-- (CF /api/auth/logout → swarm-api POST /auth/revoke-sessions) ставит её в now().
-- NULL — отзывов не было, все сессии живы. Только добавление колонки: существующие строки
-- получают NULL, ни одна текущая сессия не гасится.
alter table public.allowed_users
  add column if not exists sessions_revoked_at timestamptz;

comment on column public.allowed_users.sessions_revoked_at is
  'Веб-сессии с auth_time раньше этой отметки отклоняются (выход на всех устройствах). NULL — отзывов не было.';
