-- Веб-вход через Google Sign-In (дизайн B, спека 2026-07-29): email как ключ аутентификации.
-- allowed_users — таблица доступа/личности; email живёт здесь (а не только в user_profiles),
-- т.к. email-only юзер может существовать без telegram_id (telegram_id уже nullable).
-- Применено на прод через `supabase db query --linked` (MCP был недоступен). ADD-only, безопасно.

alter table public.allowed_users add column if not exists email text;

-- Бэкфилл из существующих профилей (строго с WHERE; email хранится в lower).
update public.allowed_users a
set email = lower(btrim(p.email))
from public.user_profiles p
where p.telegram_id = a.telegram_id
  and p.email is not null and btrim(p.email) <> ''
  and a.email is null;

-- Уникальность по lower(email) — один email = один пользователь (для резолва при входе).
create unique index if not exists allowed_users_email_lower_uq
  on public.allowed_users (lower(email)) where email is not null;
