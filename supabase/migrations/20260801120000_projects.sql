-- Project Space: проекты воркспейса + привязка задач.
-- projects.id — опаковый uuid; group_id → workspaces(id) (как sprints).
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  group_id   text not null references public.workspaces(id),
  name       text not null,
  color      text,
  emoji      text,
  created_by bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_projects_group on public.projects(group_id);

-- Обязательный grant для Data API (иначе 42501 после 2026-10-30 rollout).
grant select, insert, update, delete on public.projects to service_role;

-- Привязка задач к проекту. project_id NULL = задача не в Project Space.
-- project_linked = связана линией с хабом (true) / плавающая карточка бэклога (false).
-- Оба ADD COLUMN — безопасны. ON DELETE SET NULL: удаление проекта освобождает задачи.
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column if not exists project_linked boolean not null default false;
create index if not exists idx_tasks_project on public.tasks(project_id);
