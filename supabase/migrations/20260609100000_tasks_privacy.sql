-- supabase/migrations/20260609100000_tasks_privacy.sql
-- Личные задачи (замена Apple Reminders). Приватность зеркалит entries:
-- is_private + owner_id. Видимость в API:
--   group_id = :ws AND (is_private = false OR owner_id = :me).
-- Additive — безопасно на prod.
alter table public.tasks
  add column if not exists is_private boolean not null default false,
  add column if not exists owner_id   bigint references public.allowed_users(telegram_id);

create index if not exists idx_tasks_owner_id on public.tasks (owner_id) where is_private = true;
