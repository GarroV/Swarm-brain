-- supabase/migrations/20260609100002_sprints.sql
-- Спринты (командная Scrum-механика).
-- FIX vs исходный план: group_id text, т.к. workspaces.id = text ("cee"/"other"),
-- а не uuid — uuid-FK не создался бы (type mismatch).
create table if not exists public.sprints (
  id         uuid primary key default gen_random_uuid(),
  group_id   text not null references public.workspaces(id) on delete cascade,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  status     text not null default 'planned' check (status in ('planned','active','completed')),
  created_at timestamptz default now(),
  constraint sprint_dates check (start_date <= end_date)
);

alter table public.tasks
  add column if not exists sprint_id uuid references public.sprints(id) on delete set null;

create index if not exists idx_tasks_sprint   on public.tasks (sprint_id) where sprint_id is not null;
create index if not exists idx_sprints_group  on public.sprints (group_id, status);

-- Required for Data API access after the Oct 30 2026 rollout (см. _template_new_table.sql).
grant select, insert, update, delete on public.sprints to service_role;
