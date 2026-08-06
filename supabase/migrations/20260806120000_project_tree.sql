-- Project Space v2 (дерево задач): подзадачи + ручные позиции узлов в дереве.
-- Аддитивно и безопасно (ADD COLUMN). projects/project_id/project_linked уже есть (v1).

-- Родитель-задача для подзадачи. NULL = задача привязана к корню-проекту (или в бэклоге).
-- ON DELETE SET NULL: удаление родителя не роняет подзадачи (они всплывают к корню/бэклогу — доводит код).
alter table public.tasks add column if not exists parent_id uuid references public.tasks(id) on delete set null;
create index if not exists idx_tasks_parent on public.tasks(parent_id);

-- Ручная позиция узла в дереве проекта (мир react-flow). NULL = позиция сидируется авто-раскладкой (d3).
alter table public.tasks add column if not exists tree_x double precision;
alter table public.tasks add column if not exists tree_y double precision;
