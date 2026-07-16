-- Персональные смарт-метки задач. owner_id NOT NULL = всегда чьи-то личные.
-- group_id зарезервирован под будущие общие списки (тогда owner_id станет nullable).
create table if not exists public.task_labels (
  id         uuid primary key default gen_random_uuid(),
  group_id   text references public.workspaces(id),
  owner_id   bigint not null references public.allowed_users(telegram_id),
  name       text not null,
  icon       text not null default 'tag',
  color      text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_labels_owner on public.task_labels(owner_id);

-- Членство «задача ↔ метки» массивом прямо на задаче (safe: только личные задачи владельца).
alter table public.tasks add column if not exists label_ids uuid[] not null default '{}';
create index if not exists idx_tasks_label_ids on public.tasks using gin (label_ids);
