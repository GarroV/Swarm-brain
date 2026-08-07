-- Вложенные подпроекты на доске «Спринт»: самоссылка проекта на родителя.
-- Ровно 2 уровня (группа → подпроект) — глубину гарантирует валидация в API.
-- Аддитивно и безопасно (ADD COLUMN). on delete set null: удаление группы
-- поднимает подпроекты на верхний уровень (данные не теряются).
alter table public.projects
  add column if not exists parent_id uuid references public.projects(id) on delete set null;
create index if not exists idx_projects_parent on public.projects(parent_id);
