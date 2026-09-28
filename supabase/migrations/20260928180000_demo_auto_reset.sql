-- Демо-воркспейс сам возвращается к эталону каждые 30 минут (issue #580).
--
-- Владелец 28.09.2026: «демо мы с тобой делали чтобы он откатывался каждые пол часа к исходному
-- виду». До этой миграции сброса по расписанию не было вовсе, а два сида делили эталон пополам:
-- `supabase/demo-seed.sql` чистил три таблицы, `scripts/seed-demo.sql` доливал доску поверх и
-- падал на уникальном индексе «один живой спринт на пространство», стоило посетителю принять или
-- удалить спринт. В демо копился мусор посетителей: чужие проекты, правки целей, новые спринты.
--
-- Теперь эталон один — функция `public.demo_reset()`: в одной транзакции сносит ВСЁ, что живёт в
-- демо-воркспейсе, и засевает эталон заново. Файлы сида свелись к её вызову.
--
-- Граница «что считается демо» — ровно две вещи, обе зашиты константами в функции:
--   · воркспейс `demo` (строки с `group_id = 'demo'` и всё, что висит на них по внешним ключам);
--   · демо-пользователи 900000001..900000007 и любой, кто числится в воркспейсе `demo`.
--
-- Фидбек (`feedback`) сброс НЕ удаляет: «фидбек нужен конечно» (владелец, 28.09.2026).
-- Ни одного DELETE/UPDATE без условия на одно из двух: сброс идёт в проде раз в полчаса, и
-- промах условия стирал бы рабочие данные команды молча и регулярно.
--
-- Пользователей эталона функция НЕ удаляет, а перезаписывает (upsert со сбросом токенов,
-- e-mail и следов рекордера): на `allowed_users` без каскада смотрят `entries.owner_id`,
-- `tasks.owner_id`, `meetings.claim_owner`, `task_labels.owner_id`, и одна случайная ссылка
-- снаружи демо уронила бы весь сброс — а с ним и каждый следующий, раз в полчаса.
--
-- Что сброс НЕ трогает: файлы в бакетах Storage. Строки реестра `storage_files` уходят каскадом
-- вместе с записями, а сами объекты остаются лежать — сброс работает внутри базы.
--
-- Идемпотентно целиком (create or replace, повторная регистрация cron по имени обновляет
-- задачу): `scripts/porcha-sql` перенакатывает этот файл как восстановление.

create or replace function public.demo_reset()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Слаг воркспейса — константой, а не параметром: функцию, которой можно передать чужой
  -- воркспейс, рано или поздно вызовут с чужим воркспейсом.
  c_ws    constant text     := 'demo';
  c_users constant bigint[] := array[900000001, 900000002, 900000003, 900000004,
                                     900000005, 900000006, 900000007]::bigint[];
  v_users bigint[];
  v_counts jsonb;
begin
  -- Два сброса разом (cron + кнопка) не должны переплетаться: второй ждёт первого.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.demo_reset'));

  -- Демо-люди — ТОЛЬКО эталонные id. Живой человек, которого занесли в воркспейс demo,
  -- демо-человеком не становится: его данные в других воркспейсах (календарь, личные списки,
  -- подписки, профиль) сброс не трогает ни при каких условиях — только его строки внутри demo.
  v_users := c_users;

  -- ── 1. Снести всё демо ──────────────────────────────────────────────────────────────────
  -- Порядок — от листьев к корню, чтобы внешние ключи без каскада не отбили удаление.
  -- Спринты — первыми: иначе триггер удаления задачи перепишет их состав в «упоминания».
  delete from public.sprint_cycles      where group_id = c_ws;           -- + sprint_items каскадом
  delete from public.notifications      where group_id = c_ws or recipient_telegram_id = any (v_users);
  delete from public.task_subscriptions where telegram_id = any (v_users);
  delete from public.task_history       where group_id = c_ws;
  delete from public.tasks              where group_id = c_ws;           -- + история, комментарии, подписки
  delete from public.task_labels        where group_id = c_ws or owner_id = any (v_users);
  delete from public.project_history    where group_id = c_ws;
  delete from public.projects           where group_id = c_ws;           -- + история проекта
  delete from public.sprints            where group_id = c_ws;
  delete from public.meeting_live_notes where group_id = c_ws;
  delete from public.meetings           where group_id = c_ws;
  delete from public.entries            where group_id = c_ws;           -- + storage_files каскадом
  -- feedback не трогаем: «фидбек нужен конечно» (владелец, 28.09.2026) — отзыв из демо
  -- остаётся владельцу, сколько бы сбросов ни прошло.
  delete from public.user_integrations  where telegram_id = any (v_users);
  delete from public.recorder_diagnostics where telegram_id = any (v_users);
  delete from public.sessions           where chat_id = any (v_users);
  -- Лишний человек воркспейса (не из эталона), оставивший фидбек, остаётся вместе с профилем:
  -- по нему фидбек опознаёт автора, а ссылка «кто написал» дороже чистоты витрины.
  delete from public.user_profiles      where telegram_id = any (c_users);
  -- Лишних людей воркспейса (не эталонных) сброс НЕ удаляет: allowed_users — одна строка на
  -- человека, и её удаление каскадом стирает его профиль, то есть живого человека, которого
  -- занесли в demo, сброс вычеркнул бы из Swarm целиком. Их данные внутри demo уже снесены выше.

  -- ── 2. Воркспейс и команда ──────────────────────────────────────────────────────────────
  -- Эталон — правдоподобная работа небольшой ВЫДУМАННОЙ команды: сеть кофеен по соседству и
  -- её приложение для заказа. Ни одной реальной компании, человека или внутренней задачи:
  -- репозиторий публичный, демо смотрит внешний человек. Всё по-английски — demo-сессия
  -- рендерит UI по-английски. Даты — от сегодня, чтобы демо не старело: есть просрочка,
  -- «сегодня», «на этой неделе» и дальние сроки.
  insert into public.workspaces (id, name, allowed_markets)
  values (c_ws, 'Demo Workspace', null)
  on conflict (id) do update set name = excluded.name, allowed_markets = null;

  -- Гость (900000001, в него входит демо-ссылка) и команда. is_admin=false у всех.
  -- Токены MCP и рекордера, e-mail и следы рекордера обнуляются: посетитель мог их завести.
  insert into public.allowed_users as a
         (telegram_id, username, group_id, is_admin, added_by)
  values (900000001, 'demo',  c_ws, false, 0),
         (900000002, 'maya',  c_ws, false, 0),
         (900000003, 'tom',   c_ws, false, 0),
         (900000004, 'ines',  c_ws, false, 0),
         (900000005, 'karl',  c_ws, false, 0),
         (900000006, 'sofia', c_ws, false, 0),
         (900000007, 'nils',  c_ws, false, 0)  -- без задач: фильтр людей обязан показывать и таких
  on conflict (telegram_id) do update
     set username = excluded.username, group_id = excluded.group_id, is_admin = false,
         added_by = excluded.added_by, email = null,
         claude_mcp_token_hash = null, claude_mcp_token_expires_at = null,
         recorder_token_hash = null, recorder_token_expires_at = null,
         recorder_token_prev_hash = null, recorder_token_prev_expires_at = null,
         recorder_last_seen = null, recorder_last_recording = null,
         recorder_last_version = null, recorder_expiry_warned = false,
         recorder_last_on_call = null, recorder_last_meeting_key = null;

  -- Имена живут в user_profiles: без профиля фильтр показал бы логин вместо имени.
  insert into public.user_profiles (telegram_id, first_name, last_name, role, markets) values
    (900000001, 'Demo',  'Guest',     'bd',        array['PT','ES']),
    (900000002, 'Maya',  'Lindqvist', 'marketing', array['NL','DE']),
    (900000003, 'Tom',   'Farrow',    'bd',        array['PT']),
    (900000004, 'Ines',  'Duarte',    'bd',        array['ES','PT']),
    (900000005, 'Karl',  'Brenner',   'rnd',       array['DE']),
    (900000006, 'Sofia', 'Rinaldi',   'rnd',       array['NL']),
    (900000007, 'Nils',  'Berg',      'marketing', array['PL']);

  -- ── 3. База знаний: встречи с тезисами и заметки ────────────────────────────────────────
  -- Фиксированные id: на встречи ссылаются задачи (tasks.meeting_id = entries.id → значок
  -- «Meeting» у задачи). Тезисы — в формате TezisyBlocks (### заголовок, - пункт).
  insert into public.entries (id, content, summary, added_by, source, entry_type, entry_date,
                              metadata, countries, group_id, is_private, owner_id)
  values
    ('d0000000-0000-4000-8000-000000000501',
     'Weekly ops sync. Tom: peak hour at Harbour Street is still slow, milk steaming is the bottleneck. Ines: dairy supplier wants to renegotiate delivery windows. Guest: store #7 lease is signed, team hiring is next. Tom will check the dishwasher contract before it renews.',
     E'### Service speed\n- Peak-hour ticket time is 6–7 minutes at Harbour Street, target is under 4.\n- Milk steaming is the bottleneck; moving the fridge next to the bar is the first fix.\n### Supply\n- Dairy supplier asks to move deliveries to early morning.\n- Audit scorecard still waiting on supplier feedback.\n### Store #7\n- Lease signed, hiring starts this week.\n- Dishwasher contract renews next month — check the terms first.',
     'desktop-agent', 'desktop-agent', 'meeting', current_date - 2,
     pg_catalog.jsonb_build_object('title', 'Weekly ops sync', 'confirmed', true,
       'attendees', '[{"name":"Demo Guest"},{"name":"Tom Farrow"},{"name":"Ines Duarte"}]'::jsonb),
     array['PT'], c_ws, false, 900000001),
    ('d0000000-0000-4000-8000-000000000502',
     'App release review. Karl: wallet refunds fail on the test card in two cases. Sofia: one-tap reorder is done on iOS, Android is one day behind. Decision: release on Monday if refunds pass. Karl will share release notes with the stores.',
     E'### Release\n- One-tap reorder: iOS done, Android in review.\n- Release on Monday if refund tests pass.\n### Risks\n- Two refund cases fail on the test card — open with the provider.\n### Stores\n- Stores get short release notes before launch day.',
     'granola', 'granola', 'meeting', current_date - 1,
     pg_catalog.jsonb_build_object('title', 'App release review', 'confirmed', true,
       'attendees', '[{"name":"Karl Brenner"},{"name":"Sofia Rinaldi"},{"name":"Demo Guest"}]'::jsonb),
     array['General'], c_ws, false, 900000005),
    ('d0000000-0000-4000-8000-000000000503',
     'Autumn menu kick-off. Maya: four seasonal drinks and two pastries. Photo shoot is booked, menu boards go to print on Thursday. Prices agreed last sprint. Launch in NL and DE first, the rest a week later.',
     E'### Menu\n- Four seasonal drinks, two pastries.\n- Prices agreed; launch NL and DE first, other markets a week later.\n### Materials\n- Photo shoot booked, menu boards to print on Thursday.\n- In-store posters still need a designer.',
     'granola', 'granola', 'meeting', current_date - 4,
     pg_catalog.jsonb_build_object('title', 'Autumn menu kick-off', 'confirmed', true,
       'attendees', '[{"name":"Maya Lindqvist"},{"name":"Nils Berg"},{"name":"Demo Guest"}]'::jsonb),
     array['NL','DE'], c_ws, false, 900000002),
    ('d0000000-0000-4000-8000-000000000504',
     'Call with the dairy supplier. They can deliver before 7:00 from next month at the same price. Quality reports for the last quarter are attached to the audit. Visit to the plant planned.',
     E'### Deliveries\n- Early-morning deliveries from next month, same price.\n### Audit\n- Quarterly quality reports received.\n- Plant visit to be booked.',
     'desktop-agent', 'desktop-agent', 'meeting', current_date - 6,
     pg_catalog.jsonb_build_object('title', 'Dairy supplier call', 'confirmed', true,
       'attendees', '[{"name":"Ines Duarte"},{"name":"Demo Guest"}]'::jsonb),
     array['ES'], c_ws, false, 900000004),
    ('d0000000-0000-4000-8000-000000000511',
     'Store opening playbook: lease and permits, fit-out, equipment, hiring and training, soft opening, opening weekend, first-month review.',
     E'### Store opening playbook\n- Lease, permits and fit-out\n- Equipment order 6 weeks before opening\n- Hire and train the team 3 weeks before\n- Soft opening for neighbours, then the opening weekend\n- First-month review with the numbers',
     'Demo Guest', 'note', 'note', current_date - 12,
     pg_catalog.jsonb_build_object('title', 'Store opening playbook'), array['General'], c_ws, false, 900000001),
    ('d0000000-0000-4000-8000-000000000512',
     'Peak-hour station layout: one person on the till, one on espresso, one on milk and hand-off. Milk fridge within one step of the steam wand. Cups pre-stacked by size before 8:00.',
     E'### Peak-hour layout\n- Till, espresso, milk + hand-off — three stations\n- Milk fridge within one step of the steam wand\n- Cups pre-stacked by size before 8:00',
     'Tom Farrow', 'note', 'note', current_date - 9,
     pg_catalog.jsonb_build_object('title', 'Peak-hour station layout'), array['PT'], c_ws, false, 900000003),
    ('d0000000-0000-4000-8000-000000000513',
     'Brand voice: warm, short, neighbourly. We talk like the barista who knows your order. No jargon, no exclamation marks in prices.',
     E'### Brand voice\n- Warm, short, neighbourly\n- Talk like the barista who knows your order\n- No jargon; no exclamation marks next to prices',
     'Maya Lindqvist', 'note', 'note', current_date - 20,
     pg_catalog.jsonb_build_object('title', 'Brand voice guide'), array['General'], c_ws, false, 900000002);

  -- Встреча «на вычитке» — флоу вычитки и публикации (раздел встреч, очередь вычитки).
  insert into public.meetings (source, identity_kind, identity_key, title, started_at, attendees,
                               group_id, draft_notes_md, status, recorders)
  values ('granola', 'external', 'granola:demo-q4-planning', 'Q4 planning', now() - interval '2 hours',
          '[{"name":"Demo Guest"},{"name":"Maya Lindqvist"},{"name":"Karl Brenner"},{"name":"Tom Farrow"}]'::jsonb, c_ws,
          E'### Q4 priorities\n- Open store #7 before the holiday season.\n- Loyalty wallet live in all markets.\n- Peak-hour ticket time under 4 minutes everywhere.\n### Tasks\n- Karl: wallet rollout plan by Friday.\n- Tom: opening weekend plan for store #7.',
          'awaiting_review', '[{"telegram_id":900000001,"role":"transcribe"}]'::jsonb);

  -- ── 4. Доска проектов: вкладка, пространство спринтов, направления, инициативы ──────────
  -- Вкладка доски «Проекты» и пространство раздела «Спринты» — РАЗНЫЕ записи sprints (kind,
  -- issue #423). Фиксированные UUID: на них ссылаются спринты и задачи ниже.
  insert into public.sprints (id, group_id, name, start_date, end_date, status, kind) values
    ('d0000000-0000-4000-8000-000000000001', c_ws, 'Company roadmap',  current_date - 120, current_date + 120, 'active', 'board_tab'),
    ('d0000000-0000-4000-8000-000000000002', c_ws, 'Product & Stores', current_date,       current_date,       'active', 'space');

  -- Направления (верхний уровень, держат вкладку) — с полями справки «О проекте»: цель,
  -- описание, ссылки, ответственный, период. Ссылки — на example.com (зарезервированный домен).
  insert into public.projects (id, group_id, name, emoji, color, sprint_id, parent_id, owner_telegram_id,
                               start_date, end_date, is_private, created_by, position, goal, description, links)
  values
    ('d0000000-0000-4000-8000-000000000101', c_ws, 'Stores & Operations', '☕', '#c2703d',
     'd0000000-0000-4000-8000-000000000001', null, 900000003, current_date - 90, current_date + 90, false, 900000001, 1000,
     'Every store runs the same playbook and serves a drink in under 4 minutes at peak.',
     'Day-to-day running of our six stores and the opening of store #7: service speed, suppliers, equipment.',
     '[{"title":"Ops handbook","url":"https://example.com/ops-handbook"},{"title":"Store KPIs","url":"https://example.com/store-kpis"}]'),
    ('d0000000-0000-4000-8000-000000000102', c_ws, 'Ordering App', '📱', '#3e63dd',
     'd0000000-0000-4000-8000-000000000001', null, 900000005, current_date - 90, current_date + 90, false, 900000001, 2000,
     'Half of morning orders come through the app by the end of the year.',
     'The customer ordering app: reorder, loyalty wallet, and the dashboards stores use to see their day.',
     '[{"title":"App roadmap","url":"https://example.com/app-roadmap"}]'),
    ('d0000000-0000-4000-8000-000000000103', c_ws, 'Growth & Marketing', '📣', '#e5484d',
     'd0000000-0000-4000-8000-000000000001', null, 900000002, current_date - 60, current_date + 60, false, 900000001, 3000,
     'Grow weekly regulars by 15% through the seasonal menu and referrals.',
     'Seasonal menus, in-store materials, social media and the referral program.',
     '[{"title":"Brand voice guide","url":"https://example.com/brand-voice"}]'),
    ('d0000000-0000-4000-8000-000000000104', c_ws, 'People & Training', '👥', '#30a46c',
     'd0000000-0000-4000-8000-000000000001', null, 900000001, current_date - 60, current_date + 60, false, 900000001, 4000,
     'A new barista is confident on the bar after their first week.',
     'Hiring, onboarding and shift scheduling across all stores.',
     '[]'),
    -- Инициативы (подпроекты): вкладку наследуют у родителя, как в продукте.
    ('d0000000-0000-4000-8000-000000000111', c_ws, 'Peak-hour speed',  null, null, null, 'd0000000-0000-4000-8000-000000000101', 900000003, current_date - 45, current_date + 30, false, 900000003, 1000,
     'Ticket time under 4 minutes between 8:00 and 10:00.', 'Station layout, equipment and prep changes, measured store by store.', '[]'),
    ('d0000000-0000-4000-8000-000000000112', c_ws, 'Supplier audit',   null, null, null, 'd0000000-0000-4000-8000-000000000101', 900000004, current_date - 30, current_date + 10, false, 900000004, 2000,
     'Every supplier scored on quality and delivery once a quarter.', null, '[]'),
    ('d0000000-0000-4000-8000-000000000113', c_ws, 'Store #7 opening', null, null, null, 'd0000000-0000-4000-8000-000000000101', 900000003, current_date - 50, current_date + 40, false, 900000001, 3000,
     'Open store #7 before the holiday season.', 'Lease, fit-out, equipment, team and the opening weekend.',
     '[{"title":"Opening checklist","url":"https://example.com/store-7-checklist"}]'),
    ('d0000000-0000-4000-8000-000000000121', c_ws, 'One-tap reorder',  null, null, null, 'd0000000-0000-4000-8000-000000000102', 900000006, current_date - 40, current_date + 10, false, 900000005, 1000,
     'Regulars reorder their usual in one tap.', null, '[]'),
    ('d0000000-0000-4000-8000-000000000122', c_ws, 'Loyalty wallet',   null, null, null, 'd0000000-0000-4000-8000-000000000102', 900000005, current_date - 60, current_date + 20, false, 900000005, 2000,
     'Stamps and top-ups in the app instead of paper cards.', 'Wallet provider, SDK integration, refunds and store rollout.', '[]'),
    ('d0000000-0000-4000-8000-000000000123', c_ws, 'Store dashboards', null, null, null, 'd0000000-0000-4000-8000-000000000102', 900000005, current_date - 10, current_date + 60, false, 900000005, 3000,
     null, null, '[]'),
    ('d0000000-0000-4000-8000-000000000131', c_ws, 'Autumn menu',      null, null, null, 'd0000000-0000-4000-8000-000000000103', 900000002, current_date - 25, current_date + 14, false, 900000002, 1000,
     'Launch the autumn menu in all markets within two weeks.', null, '[]'),
    ('d0000000-0000-4000-8000-000000000132', c_ws, 'Referral program', null, null, null, 'd0000000-0000-4000-8000-000000000103', 900000002, current_date - 45, current_date + 45, false, 900000002, 2000,
     'One in ten new customers comes from a friend.', null, '[]'),
    ('d0000000-0000-4000-8000-000000000141', c_ws, 'Barista onboarding', null, null, null, 'd0000000-0000-4000-8000-000000000104', 900000004, current_date - 30, current_date + 30, false, 900000001, 1000,
     null, 'Workshops, videos and a short quiz for the first week.', '[]'),
    ('d0000000-0000-4000-8000-000000000142', c_ws, 'Shift scheduling', null, null, null, 'd0000000-0000-4000-8000-000000000104', 900000001, current_date - 50, current_date + 20, false, 900000001, 2000,
     'Rotas published two weeks ahead in every store.', null, '[]');

  -- ── 5. Задачи ───────────────────────────────────────────────────────────────────────────
  -- Все колонки доски (backlog/open/in_progress/done) плюс cancelled (вне процента спринта).
  -- Исполнитель: имя в assignees (его рисует строка) и id в assignee_telegram_ids (его берёт
  -- карточка) — согласованы. confirmed=true обязателен: веб показывает только подтверждённые.
  -- Подзадачи — через parent_id, один уровень, как в продукте.
  insert into public.tasks (id, group_id, title, description, assignees, assignee_telegram_ids, status, priority,
                            due_date, project_id, project_linked, parent_id, country, source, meeting_id,
                            remind_date, recur_freq, confirmed, is_private, owner_id, label_ids,
                            created_by_telegram_id, links)
  values
    -- Stores & Operations → Peak-hour speed
    ('d0000000-0000-4000-8000-000000000201', c_ws, 'Cut ticket time at peak hours', 'Target: under 4 minutes between 8:00 and 10:00. Measure at Harbour Street first, then roll out.', array['Tom Farrow'], array[900000003]::bigint[], 'in_progress', 'high', current_date + 3, 'd0000000-0000-4000-8000-000000000111', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000003, '[{"title":"Station layout","url":"https://example.com/station-layout"}]'),
    ('d0000000-0000-4000-8000-000000000202', c_ws, 'Time 50 orders at Harbour Street', null, array['Tom Farrow'], array[900000003]::bigint[], 'done', null, current_date - 30, 'd0000000-0000-4000-8000-000000000111', true, 'd0000000-0000-4000-8000-000000000201', 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000003, '[]'),
    ('d0000000-0000-4000-8000-000000000203', c_ws, 'Move the milk fridge next to the bar', 'Needs an electrician for the socket — booked for Thursday.', array['Tom Farrow'], array[900000003]::bigint[], 'open', null, current_date + 5, 'd0000000-0000-4000-8000-000000000111', true, 'd0000000-0000-4000-8000-000000000201', 'PT', 'transcript', 'd0000000-0000-4000-8000-000000000501', null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000204', c_ws, 'Rewrite the opening checklist', null, array['Tom Farrow'], array[900000003]::bigint[], 'done', null, current_date - 10, 'd0000000-0000-4000-8000-000000000111', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000003, '[]'),
    ('d0000000-0000-4000-8000-000000000205', c_ws, 'Map the bottleneck on the espresso bar', 'Film one peak hour, count steps per drink.', array['Tom Farrow','Ines Duarte'], array[900000003,900000004]::bigint[], 'open', 'med', current_date + 9, 'd0000000-0000-4000-8000-000000000111', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000003, '[]'),
    ('d0000000-0000-4000-8000-000000000206', c_ws, 'Trial a second grinder at two stores', null, '{}', '{}', 'backlog', null, null, 'd0000000-0000-4000-8000-000000000111', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000003, '[]'),
    -- Stores & Operations → Supplier audit
    ('d0000000-0000-4000-8000-000000000207', c_ws, 'Collect supplier quality reports', null, array['Ines Duarte'], array[900000004]::bigint[], 'done', null, current_date - 16, 'd0000000-0000-4000-8000-000000000112', true, null, 'ES', 'mini_app', null, null, null, true, false, null, '{}', 900000004, '[]'),
    ('d0000000-0000-4000-8000-000000000208', c_ws, 'Agree the audit scorecard', 'Quality 60%, delivery 30%, price 10%. Waiting on the supplier to confirm.', array['Ines Duarte'], array[900000004]::bigint[], 'in_progress', 'high', current_date - 1, 'd0000000-0000-4000-8000-000000000112', true, null, 'ES', 'mini_app', null, null, null, true, false, null, '{}', 900000004, '[]'),
    ('d0000000-0000-4000-8000-000000000209', c_ws, 'Visit the dairy plant', null, array['Ines Duarte'], array[900000004]::bigint[], 'open', null, current_date, 'd0000000-0000-4000-8000-000000000112', true, null, 'ES', 'transcript', 'd0000000-0000-4000-8000-000000000504', current_date, null, true, false, null, '{}', 900000004, '[]'),
    ('d0000000-0000-4000-8000-000000000210', c_ws, 'Price out an oat milk supplier', null, '{}', '{}', 'backlog', 'low', null, 'd0000000-0000-4000-8000-000000000112', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000004, '[]'),
    -- Stores & Operations → Store #7 opening
    ('d0000000-0000-4000-8000-000000000211', c_ws, 'Sign the lease for store #7', null, array['Demo Guest'], array[900000001]::bigint[], 'done', null, current_date - 38, 'd0000000-0000-4000-8000-000000000113', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000212', c_ws, 'Hire the store #7 team', 'One shift lead, four baristas. Interviews at Harbour Street.', array['Ines Duarte'], array[900000004]::bigint[], 'in_progress', 'high', current_date + 12, 'd0000000-0000-4000-8000-000000000113', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000213', c_ws, 'Order equipment for store #7', null, array['Tom Farrow'], array[900000003]::bigint[], 'open', 'med', current_date + 6, 'd0000000-0000-4000-8000-000000000113', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000003, '[]'),
    ('d0000000-0000-4000-8000-000000000214', c_ws, 'Plan the opening weekend', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'backlog', null, null, 'd0000000-0000-4000-8000-000000000113', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000001, '[]'),
    -- Stores & Operations — прямо на направлении, без инициативы, повторяющаяся
    ('d0000000-0000-4000-8000-000000000215', c_ws, 'Weekly stock count', 'Every store sends counts by Monday noon.', array['Tom Farrow'], array[900000003]::bigint[], 'open', null, current_date + 2, 'd0000000-0000-4000-8000-000000000101', true, null, null, 'mini_app', null, null, 'weekly', true, false, null, '{}', 900000003, '[]'),
    -- Ordering App → One-tap reorder
    ('d0000000-0000-4000-8000-000000000216', c_ws, 'Ship one-tap reorder', 'Release with the Monday build if refunds pass.', array['Sofia Rinaldi'], array[900000006]::bigint[], 'in_progress', 'high', current_date + 5, 'd0000000-0000-4000-8000-000000000121', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    ('d0000000-0000-4000-8000-000000000217', c_ws, 'Reorder button on the order history screen', null, array['Sofia Rinaldi'], array[900000006]::bigint[], 'done', null, current_date - 26, 'd0000000-0000-4000-8000-000000000121', true, 'd0000000-0000-4000-8000-000000000216', null, 'mini_app', null, null, null, true, false, null, '{}', 900000006, '[]'),
    ('d0000000-0000-4000-8000-000000000218', c_ws, 'Handle sold-out items on reorder', 'Offer the closest match instead of an error.', array['Sofia Rinaldi'], array[900000006]::bigint[], 'in_progress', null, current_date + 4, 'd0000000-0000-4000-8000-000000000121', true, 'd0000000-0000-4000-8000-000000000216', null, 'mini_app', null, null, null, true, false, null, '{}', 900000006, '[]'),
    ('d0000000-0000-4000-8000-000000000219', c_ws, 'Fix address autocomplete on mobile', null, array['Sofia Rinaldi'], array[900000006]::bigint[], 'done', null, current_date - 12, 'd0000000-0000-4000-8000-000000000121', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000006, '[]'),
    ('d0000000-0000-4000-8000-000000000220', c_ws, 'Drop the legacy payment screen', 'Cancelled: the wallet replaces it.', array['Karl Brenner'], array[900000005]::bigint[], 'cancelled', null, current_date - 2, 'd0000000-0000-4000-8000-000000000121', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    -- Ordering App → Loyalty wallet
    ('d0000000-0000-4000-8000-000000000221', c_ws, 'Pick a wallet provider', null, array['Karl Brenner'], array[900000005]::bigint[], 'done', null, current_date - 40, 'd0000000-0000-4000-8000-000000000122', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    ('d0000000-0000-4000-8000-000000000222', c_ws, 'Integrate the wallet SDK', null, array['Sofia Rinaldi'], array[900000006]::bigint[], 'done', null, current_date - 24, 'd0000000-0000-4000-8000-000000000122', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    ('d0000000-0000-4000-8000-000000000223', c_ws, 'Test refunds end to end', 'Two cases fail on the test card — ticket open with the provider.', array['Karl Brenner'], array[900000005]::bigint[], 'in_progress', 'high', current_date + 2, 'd0000000-0000-4000-8000-000000000122', true, null, null, 'transcript', 'd0000000-0000-4000-8000-000000000502', null, null, true, false, null, '{}', 900000005, '[]'),
    ('d0000000-0000-4000-8000-000000000224', c_ws, 'Write the wallet FAQ for stores', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'open', null, current_date + 8, 'd0000000-0000-4000-8000-000000000122', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    -- Ordering App → Store dashboards
    ('d0000000-0000-4000-8000-000000000225', c_ws, 'Draft the store health dashboard', 'Orders per hour, ticket time, waste.', array['Karl Brenner'], array[900000005]::bigint[], 'open', 'med', current_date + 12, 'd0000000-0000-4000-8000-000000000123', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    ('d0000000-0000-4000-8000-000000000226', c_ws, 'Pick the metrics that matter', null, '{}', '{}', 'backlog', null, null, 'd0000000-0000-4000-8000-000000000123', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000005, '[]'),
    -- Growth & Marketing → Autumn menu
    ('d0000000-0000-4000-8000-000000000228', c_ws, 'Launch the autumn menu', 'NL and DE first, other markets a week later.', array['Maya Lindqvist'], array[900000002]::bigint[], 'in_progress', 'high', current_date + 3, 'd0000000-0000-4000-8000-000000000131', true, null, 'NL', 'transcript', 'd0000000-0000-4000-8000-000000000503', null, null, true, false, null, '{}', 900000002, '[]'),
    ('d0000000-0000-4000-8000-000000000229', c_ws, 'Photo shoot for the new drinks', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'done', null, current_date - 3, 'd0000000-0000-4000-8000-000000000131', true, null, 'NL', 'mini_app', null, null, null, true, false, null, '{}', 900000002, '[]'),
    ('d0000000-0000-4000-8000-000000000230', c_ws, 'Design the in-store posters', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'open', null, current_date + 6, 'd0000000-0000-4000-8000-000000000131', true, null, 'DE', 'transcript', 'd0000000-0000-4000-8000-000000000503', null, null, true, false, null, '{}', 900000002, '[]'),
    ('d0000000-0000-4000-8000-000000000231', c_ws, 'Price the seasonal drinks', null, array['Demo Guest'], array[900000001]::bigint[], 'done', null, current_date - 23, 'd0000000-0000-4000-8000-000000000131', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000002, '[]'),
    -- Growth & Marketing → Referral program
    ('d0000000-0000-4000-8000-000000000232', c_ws, 'Draft the referral rules', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'done', null, current_date - 37, 'd0000000-0000-4000-8000-000000000132', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000002, '[]'),
    ('d0000000-0000-4000-8000-000000000233', c_ws, 'Referral landing page', null, array['Sofia Rinaldi'], array[900000006]::bigint[], 'backlog', null, null, 'd0000000-0000-4000-8000-000000000132', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000002, '[]'),
    ('d0000000-0000-4000-8000-000000000234', c_ws, 'Measure referral uptake after 30 days', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'open', 'low', current_date + 20, 'd0000000-0000-4000-8000-000000000132', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000002, '[]'),
    ('d0000000-0000-4000-8000-000000000235', c_ws, 'Weekly social media plan', null, array['Maya Lindqvist'], array[900000002]::bigint[], 'open', null, current_date + 1, 'd0000000-0000-4000-8000-000000000103', true, null, null, 'mini_app', null, null, 'weekly', true, false, null, '{}', 900000002, '[]'),
    -- People & Training
    ('d0000000-0000-4000-8000-000000000236', c_ws, 'Run the first shift-lead workshop', null, array['Tom Farrow'], array[900000003]::bigint[], 'done', null, current_date - 13, 'd0000000-0000-4000-8000-000000000141', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000004, '[]'),
    ('d0000000-0000-4000-8000-000000000237', c_ws, 'Record the onboarding videos', 'Five short videos: espresso, milk, till, cleaning, closing.', array['Tom Farrow'], array[900000003]::bigint[], 'in_progress', null, current_date - 3, 'd0000000-0000-4000-8000-000000000141', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000004, '[]'),
    ('d0000000-0000-4000-8000-000000000238', c_ws, 'Onboarding quiz for new baristas', null, array['Ines Duarte'], array[900000004]::bigint[], 'open', null, current_date + 10, 'd0000000-0000-4000-8000-000000000141', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000004, '[]'),
    ('d0000000-0000-4000-8000-000000000239', c_ws, 'Compare three scheduling tools', null, array['Demo Guest'], array[900000001]::bigint[], 'done', null, current_date - 25, 'd0000000-0000-4000-8000-000000000142', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000240', c_ws, 'Roll out the new rota at two stores', null, array['Demo Guest'], array[900000001]::bigint[], 'in_progress', 'med', current_date + 4, 'd0000000-0000-4000-8000-000000000142', true, null, 'PT', 'mini_app', null, null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000241', c_ws, 'Agree the quarterly store targets', null, array['Demo Guest'], array[900000001]::bigint[], 'open', null, current_date + 20, 'd0000000-0000-4000-8000-000000000104', true, null, null, 'mini_app', null, null, null, true, false, null, '{}', 900000001, '[]'),
    -- Без проекта: задачи со встреч
    ('d0000000-0000-4000-8000-000000000242', c_ws, 'Send the ops sync notes to store managers', null, array['Demo Guest'], array[900000001]::bigint[], 'done', null, current_date - 2, null, false, null, 'PT', 'transcript', 'd0000000-0000-4000-8000-000000000501', null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000243', c_ws, 'Check the dishwasher contract before it renews', null, array['Tom Farrow'], array[900000003]::bigint[], 'open', null, current_date + 1, null, false, null, 'PT', 'transcript', 'd0000000-0000-4000-8000-000000000501', null, null, true, false, null, '{}', 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000244', c_ws, 'Share release notes with the stores', null, array['Karl Brenner'], array[900000005]::bigint[], 'open', null, current_date, null, false, null, null, 'transcript', 'd0000000-0000-4000-8000-000000000502', null, null, true, false, null, '{}', 900000005, '[]'),
    -- Личные задачи гостя в его списках (метки личные: выбор списка делает задачу личной)
    ('d0000000-0000-4000-8000-000000000246', c_ws, 'Read: a book on checklists', null, array['Demo Guest'], array[900000001]::bigint[], 'open', null, null, null, false, null, null, 'mini_app', null, null, null, true, true, 900000001, array['d0000000-0000-4000-8000-000000000602']::uuid[], 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000247', c_ws, 'Follow up with Karl on refunds', null, array['Demo Guest'], array[900000001]::bigint[], 'open', null, current_date + 1, null, false, null, null, 'mini_app', null, current_date + 1, null, true, true, 900000001, array['d0000000-0000-4000-8000-000000000601']::uuid[], 900000001, '[]'),
    ('d0000000-0000-4000-8000-000000000248', c_ws, 'Idea: pastry pre-order in the app', null, array['Demo Guest'], array[900000001]::bigint[], 'backlog', null, null, null, false, null, null, 'mini_app', null, null, null, true, true, 900000001, array['d0000000-0000-4000-8000-000000000603']::uuid[], 900000001, '[]');

  -- Личные списки гостя (метки). Иконки — из набора редактора меток.
  insert into public.task_labels (id, group_id, owner_id, name, icon, color, sort_order) values
    ('d0000000-0000-4000-8000-000000000601', c_ws, 900000001, 'Follow up', 'flag',  '#e5484d', 1),
    ('d0000000-0000-4000-8000-000000000602', c_ws, 900000001, 'Reading',   'book',  '#3e63dd', 2),
    ('d0000000-0000-4000-8000-000000000603', c_ws, 900000001, 'Ideas',     'spark', '#f5a524', 3);

  -- Комментарии: живое обсуждение. Автор — по added_by_telegram_id (имя из профиля).
  insert into public.task_comments (id, task_id, content, added_by_telegram_id, created_at) values
    ('d0000000-0000-4000-8000-000000000701', 'd0000000-0000-4000-8000-000000000201', 'Timed it again today: 6m40s at 8:30, 3m50s at 11:00. Milk is the slow step.', 900000003, now() - interval '2 days'),
    ('d0000000-0000-4000-8000-000000000702', 'd0000000-0000-4000-8000-000000000201', 'Can we try the fridge move before the autumn menu launch? New drinks are all milk-based.', 900000002, now() - interval '1 day'),
    ('d0000000-0000-4000-8000-000000000703', 'd0000000-0000-4000-8000-000000000208', 'Supplier asked for one more week to score delivery times.', 900000004, now() - interval '3 days'),
    ('d0000000-0000-4000-8000-000000000704', 'd0000000-0000-4000-8000-000000000216', 'Design approved — keep the button above the fold, please.', 900000005, now() - interval '4 days'),
    ('d0000000-0000-4000-8000-000000000705', 'd0000000-0000-4000-8000-000000000216', 'Done on iOS, Android goes to review tomorrow.', 900000006, now() - interval '1 day'),
    ('d0000000-0000-4000-8000-000000000706', 'd0000000-0000-4000-8000-000000000223', 'Two refunds fail on the test card. Ticket open with the provider.', 900000005, now() - interval '20 hours'),
    ('d0000000-0000-4000-8000-000000000707', 'd0000000-0000-4000-8000-000000000228', 'Menu boards go to print on Thursday.', 900000002, now() - interval '3 days'),
    ('d0000000-0000-4000-8000-000000000708', 'd0000000-0000-4000-8000-000000000212', 'Three shift leads interviewed, one offer out.', 900000004, now() - interval '2 days'),
    ('d0000000-0000-4000-8000-000000000709', 'd0000000-0000-4000-8000-000000000240', 'Harbour Street is ready to try the rota from Monday.', 900000003, now() - interval '5 hours');

  -- Гость подписан на свою задачу, и у него непрочитанное уведомление о комментарии.
  insert into public.task_subscriptions (task_id, telegram_id)
  values ('d0000000-0000-4000-8000-000000000240', 900000001);
  insert into public.notifications (recipient_telegram_id, group_id, task_id, comment_id, actor_telegram_id)
  values (900000001, c_ws, 'd0000000-0000-4000-8000-000000000240', 'd0000000-0000-4000-8000-000000000709', 900000003);

  -- ── 6. Спринты: три принятых (история) и живой ──────────────────────────────────────────
  -- Двухнедельные подряд. Итоги (stats) записаны на приёмке и НЕ пересчитываются — ключи те,
  -- что читает история спринтов (plan, planDone, planPercent, extra, extraDone, carried,
  -- cancelled), и сходятся с составом ниже.
  insert into public.sprint_cycles (id, group_id, tab_id, name, start_date, end_date, check_date,
                                    status, created_by, started_at, accepted_at, accepted_by, summary, stats)
  values
    ('d0000000-0000-4000-8000-000000000301', c_ws, 'd0000000-0000-4000-8000-000000000002',
     'Sprint 10', current_date - 48, current_date - 35, current_date - 41, 'accepted',
     'Demo Guest', (current_date - 48)::timestamptz, (current_date - 35)::timestamptz, 'Demo Guest',
     'Lease signed, wallet provider picked, referral rules drafted. SDK integration moved on.',
     '{"plan":4,"planDone":3,"planPercent":75,"extra":0,"extraDone":0,"carried":1,"cancelled":0}'::jsonb),
    ('d0000000-0000-4000-8000-000000000302', c_ws, 'd0000000-0000-4000-8000-000000000002',
     'Sprint 11', current_date - 34, current_date - 21, current_date - 27, 'accepted',
     'Demo Guest', (current_date - 34)::timestamptz, (current_date - 21)::timestamptz, 'Demo Guest',
     'Wallet SDK in, seasonal prices set, scheduling tool chosen. Peak-hour work slipped.',
     '{"plan":5,"planDone":4,"planPercent":80,"extra":1,"extraDone":1,"carried":1,"cancelled":0}'::jsonb),
    ('d0000000-0000-4000-8000-000000000303', c_ws, 'd0000000-0000-4000-8000-000000000002',
     'Sprint 12', current_date - 20, current_date - 7, current_date - 13, 'accepted',
     'Demo Guest', (current_date - 20)::timestamptz, (current_date - 7)::timestamptz, 'Demo Guest',
     'Opening checklist rewritten, supplier reports collected. Audit scorecard and ticket time carried over.',
     '{"plan":5,"planDone":3,"planPercent":60,"extra":1,"extraDone":1,"carried":2,"cancelled":0}'::jsonb),
    -- Живой спринт: один незакрытый на пространство — иначе частичный уникальный индекс отобьёт.
    ('d0000000-0000-4000-8000-000000000304', c_ws, 'd0000000-0000-4000-8000-000000000002',
     'Sprint 13', current_date - 6, current_date + 7, current_date - 1, 'active',
     'Demo Guest', (current_date - 6)::timestamptz, null, null, null, null);

  -- Состав принятых спринтов — с замороженным снимком (после приёмки доска показывает клон).
  insert into public.sprint_items (id, cycle_id, task_id, in_plan, added_by, frozen_at, frozen_title,
                                   frozen_status, frozen_assignees, frozen_project, frozen_due_date,
                                   check_status, to_carry, carry_reason, carried_from, carry_count)
  values
    -- Sprint 10
    ('d0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000211', true, 'Demo Guest', (current_date - 35)::timestamptz, 'Sign the lease for store #7', 'done', array['Demo Guest'], 'Store #7 opening', current_date - 38, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000402', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000221', true, 'Demo Guest', (current_date - 35)::timestamptz, 'Pick a wallet provider', 'done', array['Karl Brenner'], 'Loyalty wallet', current_date - 40, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000403', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000232', true, 'Demo Guest', (current_date - 35)::timestamptz, 'Draft the referral rules', 'done', array['Maya Lindqvist'], 'Referral program', current_date - 37, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000404', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000222', true, 'Demo Guest', (current_date - 35)::timestamptz, 'Integrate the wallet SDK', 'in_progress', array['Sofia Rinaldi'], 'Loyalty wallet', current_date - 36, 'risk', true, 'Provider sandbox was down for three days', null, 0),
    -- Sprint 11
    ('d0000000-0000-4000-8000-000000000411', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000222', true, 'Demo Guest', (current_date - 21)::timestamptz, 'Integrate the wallet SDK', 'done', array['Sofia Rinaldi'], 'Loyalty wallet', current_date - 24, 'ok', false, null, 'd0000000-0000-4000-8000-000000000404', 1),
    ('d0000000-0000-4000-8000-000000000412', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000231', true, 'Demo Guest', (current_date - 21)::timestamptz, 'Price the seasonal drinks', 'done', array['Demo Guest'], 'Autumn menu', current_date - 23, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000413', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000239', true, 'Demo Guest', (current_date - 21)::timestamptz, 'Compare three scheduling tools', 'done', array['Demo Guest'], 'Shift scheduling', current_date - 25, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000414', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000217', true, 'Demo Guest', (current_date - 21)::timestamptz, 'Reorder button on the order history screen', 'done', array['Sofia Rinaldi'], 'One-tap reorder', current_date - 26, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000415', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000201', true, 'Demo Guest', (current_date - 21)::timestamptz, 'Cut ticket time at peak hours', 'in_progress', array['Tom Farrow'], 'Peak-hour speed', current_date - 22, 'problem', true, 'Waiting for the electrician to move the fridge', null, 0),
    ('d0000000-0000-4000-8000-000000000416', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000202', false, 'Tom Farrow', (current_date - 21)::timestamptz, 'Time 50 orders at Harbour Street', 'done', array['Tom Farrow'], 'Peak-hour speed', current_date - 30, 'ok', false, null, null, 0),
    -- Sprint 12
    ('d0000000-0000-4000-8000-000000000421', 'd0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000201', true, 'Demo Guest', (current_date - 7)::timestamptz, 'Cut ticket time at peak hours', 'in_progress', array['Tom Farrow'], 'Peak-hour speed', current_date - 8, 'problem', true, 'Fridge move still not done', 'd0000000-0000-4000-8000-000000000415', 1),
    ('d0000000-0000-4000-8000-000000000422', 'd0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000204', true, 'Demo Guest', (current_date - 7)::timestamptz, 'Rewrite the opening checklist', 'done', array['Tom Farrow'], 'Peak-hour speed', current_date - 10, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000423', 'd0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000207', true, 'Demo Guest', (current_date - 7)::timestamptz, 'Collect supplier quality reports', 'done', array['Ines Duarte'], 'Supplier audit', current_date - 16, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000424', 'd0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000219', true, 'Demo Guest', (current_date - 7)::timestamptz, 'Fix address autocomplete on mobile', 'done', array['Sofia Rinaldi'], 'One-tap reorder', current_date - 12, 'ok', false, null, null, 0),
    ('d0000000-0000-4000-8000-000000000425', 'd0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000208', true, 'Demo Guest', (current_date - 7)::timestamptz, 'Agree the audit scorecard', 'in_progress', array['Ines Duarte'], 'Supplier audit', current_date - 8, 'risk', true, 'Supplier needs another week', null, 0),
    ('d0000000-0000-4000-8000-000000000426', 'd0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000236', false, 'Ines Duarte', (current_date - 7)::timestamptz, 'Run the first shift-lead workshop', 'done', array['Tom Farrow'], 'Barista onboarding', current_date - 13, 'ok', false, null, null, 0);

  -- Состав живого спринта: снимка нет (он появляется на приёмке), есть отметки сверки,
  -- переносы с историей («×2») и упоминание задачи, удалённой уже после попадания в спринт.
  insert into public.sprint_items (id, cycle_id, task_id, in_plan, added_by, check_status, check_note,
                                   check_at, check_by, to_carry, carry_reason, carried_from,
                                   carried_manual, carry_count, removed_title, removed_project_id, removed_at)
  values
    ('d0000000-0000-4000-8000-000000000431', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000201', true,  'Demo Guest', 'problem', 'Electrician booked for Thursday, nothing to measure before that', (current_date - 1)::timestamptz, 'Tom Farrow',   true,  'Fridge move blocks the measurement', 'd0000000-0000-4000-8000-000000000421', false, 2, null, null, null),
    ('d0000000-0000-4000-8000-000000000432', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000208', true,  'Demo Guest', 'risk',    'Supplier promised the scores by Friday',                          (current_date - 1)::timestamptz, 'Ines Duarte',  false, null, 'd0000000-0000-4000-8000-000000000425', false, 1, null, null, null),
    ('d0000000-0000-4000-8000-000000000433', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000216', true,  'Demo Guest', 'ok',      null, (current_date - 1)::timestamptz, 'Sofia Rinaldi', false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000434', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000223', true,  'Demo Guest', 'risk',    'Refund cases open with the provider', (current_date - 1)::timestamptz, 'Karl Brenner', false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000435', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000212', true,  'Demo Guest', 'ok',      null, (current_date - 1)::timestamptz, 'Ines Duarte',  false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000436', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000213', true,  'Demo Guest', null,      null, null, null, false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000437', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000229', true,  'Demo Guest', 'ok',      null, (current_date - 1)::timestamptz, 'Maya Lindqvist', false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000438', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000240', true,  'Demo Guest', 'ok',      null, (current_date - 1)::timestamptz, 'Demo Guest',  false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000439', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000237', true,  'Demo Guest', null,      null, null, null, false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000440', 'd0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000225', false, 'Karl Brenner', 'ok',   null, (current_date - 1)::timestamptz, 'Karl Brenner', false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000441', 'd0000000-0000-4000-8000-000000000304', null, true, 'Demo Guest', null, null, null, null, false, null, null, null, 0,
     'Pilot the self-order kiosk', 'd0000000-0000-4000-8000-000000000123', (current_date - 2)::timestamptz);

  -- Что получилось — числами, а не словом «готово»: сброс, который ничего не записал, выглядит
  -- успешным ровно так же, как сброс, который записал всё.
  select pg_catalog.jsonb_build_object(
           'users',    (select count(*) from public.allowed_users where group_id = c_ws),
           'tasks',    (select count(*) from public.tasks         where group_id = c_ws),
           'entries',  (select count(*) from public.entries       where group_id = c_ws),
           'meetings', (select count(*) from public.meetings      where group_id = c_ws),
           'spaces',   (select count(*) from public.sprints       where group_id = c_ws),
           'projects', (select count(*) from public.projects      where group_id = c_ws),
           'cycles',   (select count(*) from public.sprint_cycles where group_id = c_ws),
           'comments', (select count(*) from public.task_comments c
                          join public.tasks t on t.id = c.task_id where t.group_id = c_ws))
    into v_counts;
  return v_counts;
end;
$$;

comment on function public.demo_reset() is
  'Возвращает демо-воркспейс (group_id=demo, пользователи 900000001..900000007) к эталону: сносит всё демо и засевает заново. Канон эталона. Вызывается pg_cron demo-reset каждые 30 минут (issue #580).';

-- Грант на PUBLIC наследуется в anon/authenticated: без REVOKE FROM PUBLIC функцию дёрнул бы
-- любой через /rest/v1/rpc с публичным ключом (урок 20260826210000_mcp_token_funcs_lockdown).
revoke all on function public.demo_reset() from public, anon, authenticated;
grant execute on function public.demo_reset() to service_role;

-- Расписание. В отличие от кронов, которые ходят в Edge Functions с секретом (их регистрируют
-- руками — секрет в миграцию не кладём), здесь секрета нет: cron зовёт функцию внутри базы.
-- Поэтому расписание живёт в миграции и доезжает до прода вместе с функцией.
-- Там, где pg_cron не включён (локальный и тестовый контуры), регистрация пропускается —
-- контур без расписания честнее, чем миграция, которая на нём падает.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('demo-reset', '*/30 * * * *', 'select public.demo_reset()');
  else
    raise notice 'pg_cron не включён — расписание demo-reset не зарегистрировано';
  end if;
end;
$$;
