-- Одна таблица `sprints` обслуживала ДВЕ разные сущности продукта:
--   1) вкладки доски «Проекты» (таб `sprint` в интерфейсе задач);
--   2) «пространства» раздела «Спринты» (`sprint_cycles.tab_id` → `sprints.id`).
--
-- Из-за этого пространство «Инициативы качества», заведённое миграцией 20260919200000 ради
-- переезда осиротевшего спринта, немедленно стало первой вкладкой доски «Проекты». В паре с
-- автовыбором первой вкладки это открывало раздел проектов на чужой вкладке, где проектов нет,
-- и весь раздел выглядел пустым у всех пользователей (фикс автовыбора — 58075b2).
--
-- Владелец 21.09.2026: «Почему в проектах написано инициатива качества? Ее там не должно быть.
-- Это для раздела про спринты» → разводим сущности признаком `kind`.
--
-- Существующие строки метим ПО ФАКТУ использования, без хардкода id: запись, на которую
-- ссылается хоть один спринт, — пространство; остальные остаются вкладками доски.

alter table public.sprints
  add column if not exists kind text not null default 'board_tab';

update public.sprints s
set kind = 'space'
where s.kind <> 'space'
  and exists (select 1 from public.sprint_cycles c where c.tab_id = s.id);

alter table public.sprints
  drop constraint if exists sprints_kind_check;

alter table public.sprints
  add constraint sprints_kind_check check (kind in ('board_tab', 'space'));

comment on column public.sprints.kind is
  'board_tab — вкладка доски «Проекты»; space — пространство раздела «Спринты». Разведены 21.09.2026: общая таблица на две сущности уронила раздел проектов (см. issue #423).';
