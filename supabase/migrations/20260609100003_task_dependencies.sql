-- supabase/migrations/20260609100003_task_dependencies.sql
-- Зависимости между задачами (blocks / relates_to / duplicates).
-- Цикл-детекция выполняется в API через get_all_dependencies() перед INSERT.
-- Безопасность (проверяется в API): обе задачи должны быть в одном group_id.
create table if not exists public.task_dependencies (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  depends_on_id   uuid not null references public.tasks(id) on delete cascade,
  dependency_type text not null default 'blocks'
                  check (dependency_type in ('blocks','relates_to','duplicates')),
  created_at      timestamptz default now(),
  unique (task_id, depends_on_id),
  constraint no_self_dependency check (task_id <> depends_on_id)
);

create index if not exists idx_deps_task       on public.task_dependencies (task_id);
create index if not exists idx_deps_depends_on on public.task_dependencies (depends_on_id);

grant select, insert, update, delete on public.task_dependencies to service_role;

-- Рекурсивный обход всех транзитивных зависимостей задачи.
-- search_path фиксирован (security), как в match_entries.
create or replace function public.get_all_dependencies(root_id uuid)
returns table(id uuid)
language sql stable
set search_path = public
as $$
  with recursive deps as (
    select depends_on_id as id from public.task_dependencies where task_id = root_id
    union
    select td.depends_on_id from public.task_dependencies td inner join deps d on td.task_id = d.id
  )
  select id from deps;
$$;
