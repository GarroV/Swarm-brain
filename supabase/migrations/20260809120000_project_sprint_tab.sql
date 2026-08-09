-- Вкладка владеет проектами: проект принадлежит одной вкладке (sprints), а не всему воркспейсу.
-- Доска «Проекты» фильтрует проекты по выбранной вкладке; вкладки остаются общими (видны команде).
-- Аддитивно и безопасно (ADD COLUMN, nullable). on delete set null: удаление вкладки не удаляет
-- проекты — они просто выходят из вкладки (sprint_id = null), как и задачи.
alter table public.projects
  add column if not exists sprint_id uuid references public.sprints(id) on delete set null;
create index if not exists idx_projects_sprint on public.projects(sprint_id);

-- Разовый перенос существующих проектов в вкладку «Гарро» (решение владельца 2026-08-09).
-- Безопасно и идемпотентно: трогает только проекты без вкладки; на окружениях, где вкладки
-- «Гарро» нет (local/чистое), подзапрос не находит строк и UPDATE — no-op.
update public.projects p
   set sprint_id = s.id
  from public.sprints s
 where p.sprint_id is null
   and s.group_id = p.group_id
   and s.name = 'Гарро';
