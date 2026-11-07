-- «Расход» пространства в админке показывал $0: колонка model_usage.group_id была пустой у всех
-- строк — вызовы моделей не сообщали пространство, а чтение по пространству фильтрует по нему.
-- Основное лечение — в коде (подпись вызова теперь несёт group_id). Здесь страховка и бэкфилл.
--
-- Аддитивно. Бэкфилл — только для строк со встречей: пространство берётся из meetings.group_id.
-- Строки без meeting_id (служебные вызовы, старые mcp:/bot:/web:/meta-extract:*) пространство
-- задним числом восстановить нечем — они остаются без group_id и видны только мастеру без фильтра.

create or replace function public.model_usage_fill_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_id is null and new.meeting_id is not null then
    select m.group_id into new.group_id from public.meetings m where m.id = new.meeting_id;
  end if;
  return new;
end;
$$;

revoke all on function public.model_usage_fill_group() from public, anon, authenticated;

drop trigger if exists model_usage_fill_group on public.model_usage;
create trigger model_usage_fill_group
  before insert on public.model_usage
  for each row execute function public.model_usage_fill_group();

update public.model_usage u
   set group_id = m.group_id
  from public.meetings m
 where u.group_id is null
   and u.meeting_id = m.id
   and m.group_id is not null;

comment on column public.model_usage.group_id is
  'Пространство вызова. Задаёт код (подпись вызова); если пусто, а есть meeting_id — триггер берёт пространство встречи. У служебных вызовов без встречи может быть NULL.';
