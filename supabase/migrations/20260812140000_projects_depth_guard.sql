-- DB-гард глубины вложенности проектов (ровно 2 уровня). Раньше инвариант держался ТОЛЬКО в коде
-- (validateParent) → при конкурентных правках возможен TOCTOU и 3-й уровень (issue #13).
-- Триггер блокирует строку родителя (FOR SHARE), чтобы конкурентная смена его уровня не проскочила.
create or replace function public.projects_enforce_depth() returns trigger
language plpgsql as $$
declare
  parent_parent uuid;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'project cannot be its own parent';
    end if;
    -- Родитель должен быть верхнего уровня. FOR SHARE — блок конкурентной правки его parent_id.
    select parent_id into parent_parent from public.projects where id = new.parent_id for share;
    if not found then
      raise exception 'parent project % not found', new.parent_id;
    end if;
    if parent_parent is not null then
      raise exception 'max nesting depth is 2: parent % is itself a subproject', new.parent_id;
    end if;
    -- Нельзя делать подпроектом проект, у которого уже есть дети (иначе получится 3 уровня).
    if exists (select 1 from public.projects where parent_id = new.id) then
      raise exception 'project % has children and cannot become a subproject', new.id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_projects_depth on public.projects;
create trigger trg_projects_depth
  before insert or update of parent_id on public.projects
  for each row execute function public.projects_enforce_depth();
