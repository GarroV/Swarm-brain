-- Спринт без пространства — дефект по решению владельца 19.09.2026: «не может быть спринта
-- без пространства». Единственная сирота («Спринт 11.09 — 24.09», активный) переезжает в
-- пространство «Инициативы качества» — имя дал владелец. Заодно снимается тестовое пространство
-- `qef` (0 задач, 0 спринтов) — владелец: «я не знаю что это такое. удаляй».
--
-- Запрет на `tab_id is null` здесь НЕ ставится: пока интерфейс не умеет заводить пространства,
-- жёсткое ограничение оставило бы человека без пути создать спринт. Ограничение — следующим
-- шагом, вместе с CRUD пространств (#403).

-- Пространство под осиротевшие спринты. Даты обязательны схемой, поэтому берём их у спринта,
-- который сюда переезжает.
insert into public.sprints (group_id, name, start_date, end_date, status)
select c.group_id, 'Инициативы качества', min(c.start_date), max(c.end_date), 'planned'
from public.sprint_cycles c
where c.tab_id is null
  and not exists (
    select 1 from public.sprints s
    where s.group_id = c.group_id and s.name = 'Инициативы качества'
  )
group by c.group_id;

-- Переезд сирот. Пространство ищем по имени в том же воркспейсе — так шаг идемпотентен и
-- повторный накат ничего не портит.
update public.sprint_cycles c
set tab_id = s.id
from public.sprints s
where c.tab_id is null
  and s.group_id = c.group_id
  and s.name = 'Инициативы качества';

-- Тестовое пространство. Удаляем только если оно так и осталось пустым: задача или спринт,
-- появившиеся там после написания миграции, важнее чистоты списка.
delete from public.sprints s
where s.name = 'qef'
  and not exists (select 1 from public.sprint_cycles c where c.tab_id = s.id)
  and not exists (select 1 from public.tasks t where t.sprint_id = s.id);
