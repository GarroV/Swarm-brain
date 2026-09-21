-- Восстановление пространств доски «Проекты».
--
-- Пространства по людям («Гарро», «Ксюша», «Аня», «Паша») жили в таблице `sprints` и владели
-- проектами через `projects.sprint_id` (заведено миграцией 20260809120000). К 21.09.2026 в
-- таблице не осталось ни одного из них, а `sprint_id` у всех 54 проектов оказался null: из-за
-- `on delete set null` удаление пространства молча выносит из него все проекты. Владелец
-- 21.09.2026: «там были пространства каждого пользователя… В каждом пространстве создавались
-- проекты и там находились. пространства по сути публичные».
--
-- Точной раскладки не сохранилось (истории у проектов нет), поэтому восстанавливаем по
-- достоверному следу: проект верхнего уровня возвращается в пространство СВОЕГО СОЗДАТЕЛЯ
-- (`projects.created_by`), подпроект — за родителем, ровно как наследование работало в коде.
-- Имена пространств — со слов владельца; «Гарро» дополнительно подтверждается миграцией
-- 20260809120000.
--
-- Пространства проектов помечаются `kind = 'board_tab'`: раздел «Спринты» со своими
-- пространствами — ОТДЕЛЬНАЯ сущность (владелец 21.09.2026: «не перепутай с тем что мы
-- прорабатывали для функционала спринтов»), и в переключатель спринтов эти строки не попадут.

insert into public.sprints (group_id, name, start_date, end_date, status, kind)
select 'cee', v.name, current_date, current_date, 'planned', 'board_tab'
  from (values ('Гарро'), ('Ксюша'), ('Аня'), ('Паша')) as v(name)
 where not exists (
   select 1 from public.sprints s
    where s.group_id = 'cee' and s.name = v.name and s.kind = 'board_tab'
 );

-- Раскладка: владелец пространства — создатель проекта верхнего уровня; подпроект наследует
-- пространство родителя. Трогаем только проекты БЕЗ пространства — повторный накат ничего не
-- перекладывает, и проект, который человек уже перенёс руками, остаётся там, куда его положили.
with space_of as (
  select p.id,
         case coalesce(parent.created_by, p.created_by)
           when 744230399 then 'Гарро'
           when 507931827 then 'Ксюша'
           when 948997600 then 'Аня'
           when 671465332 then 'Паша'
         end as space_name
    from public.projects p
    left join public.projects parent on parent.id = p.parent_id
   where p.group_id = 'cee' and p.sprint_id is null
)
update public.projects p
   set sprint_id = s.id
  from space_of so
  join public.sprints s
    on s.group_id = 'cee' and s.kind = 'board_tab' and s.name = so.space_name
 where p.id = so.id;
