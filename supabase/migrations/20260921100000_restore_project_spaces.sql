-- Восстановление пространств доски «Проекты».
--
-- Пространства по людям жили в таблице `sprints` и владели проектами через
-- `projects.sprint_id` (заведено миграцией 20260809120000). К 21.09.2026 в таблице не осталось
-- ни одного, а `sprint_id` у всех проектов оказался null: `on delete set null` молча выносит
-- проекты из удаляемого пространства. Владелец 21.09.2026: «там были пространства каждого
-- пользователя… В каждом пространстве создавались проекты и там находились».
--
-- Истории у проектов нет (issue #426), поэтому раскладка восстанавливается по достоверному
-- следу: проект верхнего уровня — в пространство СВОЕГО СОЗДАТЕЛЯ, подпроект — за родителем,
-- ровно как наследование работало в коде. Ни идентификаторов, ни имён людей здесь нет: и
-- владелец пространства, и его название берутся из данных (`projects.created_by` →
-- `user_profiles`), потому что репозиторий публичный.
--
-- Пространства проектов помечаются `kind = 'board_tab'`: раздел «Спринты» со своими
-- пространствами — ОТДЕЛЬНАЯ сущность (владелец 21.09.2026: «не перепутай с тем что мы
-- прорабатывали для функционала спринтов»), и в переключатель спринтов эти строки не попадут.

-- Пространство на каждого, чьи проекты остались без места. Имя — из профиля человека.
insert into public.sprints (group_id, name, start_date, end_date, status, kind)
select distinct p.group_id, up.first_name, current_date, current_date, 'planned', 'board_tab'
  from public.projects p
  join public.user_profiles up on up.telegram_id = p.created_by
 where p.parent_id is null
   and p.sprint_id is null
   and up.first_name is not null
   and not exists (
     select 1 from public.sprints s
      where s.group_id = p.group_id and s.name = up.first_name and s.kind = 'board_tab'
   );

-- Раскладка: владелец пространства — создатель проекта верхнего уровня; подпроект наследует
-- пространство родителя. Трогаем только проекты БЕЗ пространства — повторный накат ничего не
-- перекладывает, и проект, который человек уже перенёс руками, остаётся там, куда его положили.
with space_of as (
  select p.id,
         p.group_id,
         up.first_name as space_name
    from public.projects p
    left join public.projects parent on parent.id = p.parent_id
    join public.user_profiles up
      on up.telegram_id = coalesce(parent.created_by, p.created_by)
   where p.sprint_id is null
)
update public.projects p
   set sprint_id = s.id
  from space_of so
  join public.sprints s
    on s.group_id = so.group_id and s.kind = 'board_tab' and s.name = so.space_name
 where p.id = so.id;
