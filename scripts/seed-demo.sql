-- Демо-сид доски инициатив: пространство, направления, инициативы, живой спринт с отметками
-- и принятый спринт с итогами.
--
-- Правила, по которым он написан:
--
-- 1. Данные ВЫДУМАНЫ и по-английски. Демо смотрит внешний человек, и настоящие задачи команды
--    в нём показывать нельзя — ни именами, ни формулировками.
-- 2. Даты СЧИТАЮТСЯ ОТ СЕГОДНЯ, а не записаны числами. Демо с прошлогодними датами выглядит
--    мёртвым ровно тогда, когда его открывают, — а открывают его редко и внезапно.
-- 3. Идемпотентно: фиксированные UUID + `on conflict do update`. Повторный прогон приводит
--    демо к эталону, а не плодит второй комплект.
-- 4. Пишет ТОЛЬКО в свой воркспейс (`:gid`). Ни одной строки без `group_id`, ни одного
--    `delete`/`update` без `where group_id = :gid` — чтобы прогон по ошибке не стёр чужое.
--
-- Запускать через `scripts/seed-demo.sh` — он проверяет, в какую базу целится.

\set ON_ERROR_STOP on

begin;

-- Воркспейс демо. Слаг опаковый и нейтральный: переименование витрины его не трогает.
insert into workspaces (id, name)
values (:'gid', 'Demo Workspace')
on conflict (id) do update set name = excluded.name;

-- Демо-пользователь. Без него демо-вход открывается отказом «User not in allowed list»:
-- сессию выдаёт витрина, а право читать воркспейс живёт в базе. Поймано живым прогоном
-- стенда 19.09 — сид считался готовым, а демо не открывалось.
-- Id тот же, что зашит в `functions/api/auth/demo.ts` и в барьере `isDemo` у swarm-api.
-- Команда демо-воркспейса. Люди заводятся ОТДЕЛЬНО от задач: фильтр исполнителей берёт
-- список людей, а не выводит его из задач, и демо обязано это показывать — включая
-- человека, у которого задач сейчас нет.
insert into allowed_users (telegram_id, username, added_by, is_admin, group_id)
values
  (900000002, 'maya',  0, false, :'gid'),
  (900000003, 'tom',   0, false, :'gid'),
  (900000004, 'ines',  0, false, :'gid'),
  (900000005, 'karl',  0, false, :'gid'),
  (900000006, 'sofia', 0, false, :'gid'),
  (900000007, 'nils',  0, false, :'gid')  -- без задач: фильтр обязан показывать и таких
on conflict (telegram_id) do update
  set group_id = excluded.group_id, username = excluded.username, is_admin = false;

-- Имена людей живут в user_profiles, а не в allowed_users: без профиля фильтр показал бы
-- логин вместо имени, и демо выглядело бы недоделанным.
insert into user_profiles (telegram_id, first_name, last_name)
values
  (900000002, 'Maya', 'Lindqvist'),
  (900000003, 'Tom', 'Farrow'),
  (900000004, 'Ines', 'Duarte'),
  (900000005, 'Karl', 'Brenner'),
  (900000006, 'Sofia', 'Rinaldi'),
  (900000007, 'Nils', 'Berg')
on conflict (telegram_id) do update
  set first_name = excluded.first_name, last_name = excluded.last_name;

insert into allowed_users (telegram_id, username, added_by, is_admin, group_id)
values (900000001, 'demo', 0, false, :'gid')
on conflict (telegram_id) do update
  set group_id = excluded.group_id, is_admin = false, username = excluded.username;

-- Пространство = вкладка доски. Имя выдумано; к реальным проектам команды отношения не имеет.
insert into sprints (id, group_id, name, start_date, end_date, status)
values ('d0000000-0000-4000-8000-000000000001', :'gid', 'Store Experience',
        current_date - 90, current_date + 90, 'active')
on conflict (id) do update
  set name = excluded.name, group_id = excluded.group_id,
      start_date = excluded.start_date, end_date = excluded.end_date;

-- Направления (проекты верхнего уровня) и инициативы (подпроекты). Вкладку держит
-- `sprint_id` у направления; подпроект наследует её у родителя — так же, как в продукте.
insert into projects (id, group_id, name, emoji, sprint_id, parent_id,
                      owner_telegram_id, start_date, end_date, is_private, created_by)
values
  ('d0000000-0000-4000-8000-000000000101', :'gid', 'Operations',  '🍕',
   'd0000000-0000-4000-8000-000000000001', null, null, null, null, false, null),
  ('d0000000-0000-4000-8000-000000000102', :'gid', 'Technology',  '⚙️',
   'd0000000-0000-4000-8000-000000000001', null, null, null, null, false, null),
  ('d0000000-0000-4000-8000-000000000103', :'gid', 'People',      '👥',
   'd0000000-0000-4000-8000-000000000001', null, null, null, null, false, null),

  ('d0000000-0000-4000-8000-000000000111', :'gid', 'Kitchen Flow', null, null,
   'd0000000-0000-4000-8000-000000000101', null, current_date - 60, current_date + 30, false, null),
  ('d0000000-0000-4000-8000-000000000112', :'gid', 'Supplier Audit', null, null,
   'd0000000-0000-4000-8000-000000000101', null, current_date - 20, current_date - 2, false, null),
  ('d0000000-0000-4000-8000-000000000113', :'gid', 'Order App', null, null,
   'd0000000-0000-4000-8000-000000000102', null, current_date - 45, current_date + 45, false, null),
  ('d0000000-0000-4000-8000-000000000114', :'gid', 'Store Dashboards', null, null,
   'd0000000-0000-4000-8000-000000000102', null, current_date - 10, current_date + 60, false, null),
  ('d0000000-0000-4000-8000-000000000115', :'gid', 'Shift Training', null, null,
   'd0000000-0000-4000-8000-000000000103', null, current_date - 30, current_date + 15, false, null)
on conflict (id) do update
  set name = excluded.name, emoji = excluded.emoji, sprint_id = excluded.sprint_id,
      parent_id = excluded.parent_id, group_id = excluded.group_id,
      start_date = excluded.start_date, end_date = excluded.end_date;

-- Задачи. Исполнители — строки-имена (в продукте это тоже имена, а не id).
-- Статусы покрывают всё, что умеет показать доска, включая `cancelled` — отменённое стоит
-- вне процента, и демо обязано это показывать, иначе цифра выглядит завышенной без причины.
insert into tasks (id, group_id, title, assignees, assignee_telegram_ids, status, due_date,
                   project_id, project_linked, source, created_by, confirmed, is_private, links)
values
  ('d0000000-0000-4000-8000-000000000201', :'gid', 'Cut ticket time at peak hours',
   array['Maya Lindqvist'], array[]::bigint[], 'in_progress', current_date + 3,
   'd0000000-0000-4000-8000-000000000111', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000202', :'gid', 'Rewrite the prep checklist',
   array['Tom Farrow'], array[]::bigint[], 'done', current_date - 4,
   'd0000000-0000-4000-8000-000000000111', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000203', :'gid', 'Map the dough line bottleneck',
   array['Maya Lindqvist','Karl Brenner'], array[]::bigint[], 'open', current_date + 9,
   'd0000000-0000-4000-8000-000000000111', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000204', :'gid', 'Collect supplier quality reports',
   array['Ines Duarte'], array[]::bigint[], 'done', current_date - 8,
   'd0000000-0000-4000-8000-000000000112', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000205', :'gid', 'Agree the audit scorecard',
   array['Ines Duarte'], array[]::bigint[], 'in_progress', current_date - 1,
   'd0000000-0000-4000-8000-000000000112', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000206', :'gid', 'Ship one-tap reorder',
   array['Sofia Rinaldi'], array[]::bigint[], 'in_progress', current_date + 5,
   'd0000000-0000-4000-8000-000000000113', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000207', :'gid', 'Fix address autocomplete on mobile',
   array['Sofia Rinaldi'], array[]::bigint[], 'done', current_date - 6,
   'd0000000-0000-4000-8000-000000000113', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000208', :'gid', 'Drop the legacy payment screen',
   array['Karl Brenner'], array[]::bigint[], 'cancelled', current_date - 2,
   'd0000000-0000-4000-8000-000000000113', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-000000000209', :'gid', 'Draft the store health dashboard',
   array['Karl Brenner'], array[]::bigint[], 'open', current_date + 12,
   'd0000000-0000-4000-8000-000000000114', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-00000000020a', :'gid', 'Pick the metrics that matter',
   array[]::text[], array[]::bigint[], 'open', null,
   'd0000000-0000-4000-8000-000000000114', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-00000000020b', :'gid', 'Run the first shift-lead workshop',
   array['Tom Farrow'], array[]::bigint[], 'done', current_date - 12,
   'd0000000-0000-4000-8000-000000000115', true, 'demo', 'demo', true, false, '[]'::jsonb),
  ('d0000000-0000-4000-8000-00000000020c', :'gid', 'Record the onboarding videos',
   array['Tom Farrow'], array[]::bigint[], 'in_progress', current_date - 3,
   'd0000000-0000-4000-8000-000000000115', true, 'demo', 'demo', true, false, '[]'::jsonb),
  -- Задача прямо на направлении, без инициативы: доска обязана показать и такую (иначе
  -- «голое» направление выглядит пустым, хотя работа в нём идёт).
  ('d0000000-0000-4000-8000-00000000020d', :'gid', 'Agree the quarterly store targets',
   array['Maya Lindqvist'], array[]::bigint[], 'open', current_date + 20,
   'd0000000-0000-4000-8000-000000000103', true, 'demo', 'demo', true, false, '[]'::jsonb)
on conflict (id) do update
  set title = excluded.title, assignees = excluded.assignees, status = excluded.status,
      due_date = excluded.due_date, project_id = excluded.project_id,
      project_linked = excluded.project_linked, group_id = excluded.group_id;

-- Принятый спринт: итоги посчитаны на приёмке и НЕ пересчитываются — демо показывает
-- именно записанное число, как и продукт.
insert into sprint_cycles (id, group_id, tab_id, name, start_date, end_date, check_date,
                           status, created_by, started_at, accepted_at, accepted_by, summary, stats)
values ('d0000000-0000-4000-8000-000000000301', :'gid', 'd0000000-0000-4000-8000-000000000001',
        'Sprint 12', current_date - 28, current_date - 15, current_date - 21, 'accepted',
        'demo', (current_date - 28)::timestamptz, (current_date - 15)::timestamptz, 'demo',
        'Prep checklist rewritten, supplier reports collected. Audit scorecard slipped a week.',
        '{"planned":5,"planDone":3,"planPercent":60,"extra":1,"extraDone":1,"carried":2,"cancelled":0}'::jsonb)
on conflict (id) do update
  set name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date,
      check_date = excluded.check_date, status = excluded.status, summary = excluded.summary,
      stats = excluded.stats, tab_id = excluded.tab_id, group_id = excluded.group_id,
      started_at = excluded.started_at, accepted_at = excluded.accepted_at;

-- Живой спринт: один незакрытый на пространство — иначе частичный уникальный индекс отобьёт.
insert into sprint_cycles (id, group_id, tab_id, name, start_date, end_date, check_date,
                           status, created_by, started_at)
values ('d0000000-0000-4000-8000-000000000302', :'gid', 'd0000000-0000-4000-8000-000000000001',
        'Sprint 13', current_date - 6, current_date + 7, current_date - 1, 'active',
        'demo', (current_date - 6)::timestamptz)
on conflict (id) do update
  set name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date,
      check_date = excluded.check_date, status = excluded.status, tab_id = excluded.tab_id,
      group_id = excluded.group_id, started_at = excluded.started_at;

-- Состав принятого спринта — с замороженным снимком: после приёмки доска показывает клон,
-- а не сегодняшнее состояние задачи.
insert into sprint_items (id, cycle_id, task_id, in_plan, added_by, frozen_at, frozen_title,
                          frozen_status, frozen_assignees, frozen_project, frozen_due_date,
                          check_status, to_carry, carry_reason, carry_count)
values
  ('d0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000202', true, 'demo', (current_date - 15)::timestamptz,
   'Rewrite the prep checklist', 'done', array['Tom Farrow'], 'Kitchen Flow',
   current_date - 16, 'ok', false, null, 0),
  ('d0000000-0000-4000-8000-000000000402', 'd0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000204', true, 'demo', (current_date - 15)::timestamptz,
   'Collect supplier quality reports', 'done', array['Ines Duarte'], 'Supplier Audit',
   current_date - 18, 'ok', false, null, 0),
  ('d0000000-0000-4000-8000-000000000403', 'd0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000207', true, 'demo', (current_date - 15)::timestamptz,
   'Fix address autocomplete on mobile', 'done', array['Sofia Rinaldi'], 'Order App',
   current_date - 17, 'ok', false, null, 0),
  ('d0000000-0000-4000-8000-000000000404', 'd0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000205', true, 'demo', (current_date - 15)::timestamptz,
   'Agree the audit scorecard', 'in_progress', array['Ines Duarte'], 'Supplier Audit',
   current_date - 15, 'risk', true, 'Waiting for the supplier to confirm the scoring', 0),
  ('d0000000-0000-4000-8000-000000000405', 'd0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000201', true, 'demo', (current_date - 15)::timestamptz,
   'Cut ticket time at peak hours', 'in_progress', array['Maya Lindqvist'], 'Kitchen Flow',
   current_date - 15, 'problem', true, 'Blocked by the oven replacement schedule', 0),
  -- Взято сверх плана и закрыто: план и «сверх плана» считаются отдельно.
  ('d0000000-0000-4000-8000-000000000406', 'd0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-00000000020b', false, 'demo', (current_date - 15)::timestamptz,
   'Run the first shift-lead workshop', 'done', array['Tom Farrow'], 'Shift Training',
   current_date - 20, 'ok', false, null, 0)
on conflict (id) do update
  set frozen_title = excluded.frozen_title, frozen_status = excluded.frozen_status,
      frozen_assignees = excluded.frozen_assignees, frozen_project = excluded.frozen_project,
      frozen_due_date = excluded.frozen_due_date, check_status = excluded.check_status,
      to_carry = excluded.to_carry, carry_reason = excluded.carry_reason,
      in_plan = excluded.in_plan, carry_count = excluded.carry_count;

-- Состав живого спринта: снимка нет (он появляется на приёмке), зато есть отметки сверки,
-- переносы с историей («×2») и упоминание удалённой задачи.
insert into sprint_items (id, cycle_id, task_id, in_plan, added_by, check_status, check_note,
                          check_at, check_by, to_carry, carry_reason, carried_from,
                          carried_manual, carry_count, removed_title, removed_project_id, removed_at)
values
  ('d0000000-0000-4000-8000-000000000411', 'd0000000-0000-4000-8000-000000000302',
   'd0000000-0000-4000-8000-000000000205', true, 'demo', 'risk',
   'Supplier still silent, chasing by phone', (current_date - 1)::timestamptz, 'Ines Duarte',
   false, null, 'd0000000-0000-4000-8000-000000000404', false, 1, null, null, null),
  ('d0000000-0000-4000-8000-000000000412', 'd0000000-0000-4000-8000-000000000302',
   'd0000000-0000-4000-8000-000000000201', true, 'demo', 'problem',
   'Oven arrives next month, nothing to measure until then', (current_date - 1)::timestamptz,
   'Maya Lindqvist', true, 'Nothing moves before the oven is in', 
   'd0000000-0000-4000-8000-000000000405', false, 2, null, null, null),
  ('d0000000-0000-4000-8000-000000000413', 'd0000000-0000-4000-8000-000000000302',
   'd0000000-0000-4000-8000-000000000206', true, 'demo', 'ok', null,
   (current_date - 1)::timestamptz, 'Sofia Rinaldi', false, null, null, null, 0, null, null, null),
  ('d0000000-0000-4000-8000-000000000414', 'd0000000-0000-4000-8000-000000000302',
   'd0000000-0000-4000-8000-00000000020c', true, 'demo', null, null, null, null,
   false, null, null, null, 0, null, null, null),
  ('d0000000-0000-4000-8000-000000000415', 'd0000000-0000-4000-8000-000000000302',
   'd0000000-0000-4000-8000-000000000209', false, 'demo', 'ok', null,
   (current_date - 1)::timestamptz, 'Karl Brenner', false, null, null, null, 0, null, null, null),
  -- Задача, удалённая уже после того, как попала в спринт: остаётся упоминанием, иначе
  -- состав спринта задним числом становится меньше, чем был.
  ('d0000000-0000-4000-8000-000000000416', 'd0000000-0000-4000-8000-000000000302',
   null, true, 'demo', null, null, null, null, false, null, null, null, 0,
   'Pilot the self-order kiosk', 'd0000000-0000-4000-8000-000000000113',
   (current_date - 2)::timestamptz)
on conflict (id) do update
  set check_status = excluded.check_status, check_note = excluded.check_note,
      check_at = excluded.check_at, check_by = excluded.check_by, to_carry = excluded.to_carry,
      carry_reason = excluded.carry_reason, carried_from = excluded.carried_from,
      carry_count = excluded.carry_count, in_plan = excluded.in_plan,
      removed_title = excluded.removed_title, removed_project_id = excluded.removed_project_id,
      removed_at = excluded.removed_at;

commit;

-- Что получилось — печатаем числами, а не словом «готово»: сид, который ничего не записал,
-- выглядит успешным ровно так же, как сид, который записал всё.
select 'demo user'   as entity, count(*) from allowed_users   where group_id = :'gid'
union all select 'spaces',     count(*) from sprints        where group_id = :'gid'
union all select 'directions', count(*) from projects        where group_id = :'gid' and parent_id is null
union all select 'initiatives', count(*) from projects       where group_id = :'gid' and parent_id is not null
union all select 'tasks',      count(*) from tasks           where group_id = :'gid'
union all select 'cycles',     count(*) from sprint_cycles   where group_id = :'gid'
union all select 'items',      count(*) from sprint_items si
  join sprint_cycles c on c.id = si.cycle_id where c.group_id = :'gid';
