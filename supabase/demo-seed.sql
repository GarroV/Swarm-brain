-- Demo-воркспейс для показа заказчику. Идемпотентный SEED = RESET к эталону:
-- полностью пересоздаёт группу 'demo' и её данные. Безопасно для прод — трогает ТОЛЬКО
-- group_id='demo' и зашитые demo-telegram_id (900000001..900000004), реальные данные не касаются.
--
-- ЯЗЫК ДАННЫХ — АНГЛИЙСКИЙ: demo-сессия (is_demo) рендерит UI по-английски (см. useDt в miniapp),
-- поэтому demo-контент (задачи/встречи/тезисы/имена) тоже на английском — витрина для портфолио.
--
-- Применение / ресет: выполнить этот файл целиком (Management API database/query или psql).
-- Вход заказчика — секретная ссылка /api/auth/demo?key=<DEMO_ACCESS_KEY> (см. Pages Function).
-- Изоляция от рабочих воркспейсов — барьер isDemo в swarm-api (force group='demo', not admin).

begin;

-- 1. Снести прошлый demo-набор (ресет к эталону). Только demo — реальные данные не трогаем.
delete from tasks    where group_id = 'demo';
delete from meetings where group_id = 'demo';
delete from entries  where group_id = 'demo';
delete from user_profiles where telegram_id in (900000001, 900000002, 900000003, 900000004);
delete from allowed_users where telegram_id in (900000001, 900000002, 900000003, 900000004);

-- 2. Demo-воркспейс.
insert into workspaces (id, name) values ('demo', 'Demo — Swarm Brain')
  on conflict (id) do update set name = excluded.name;

-- 3. Demo-команда (гость-заказчик + 3 fake-сотрудника). is_admin=false у всех (барьер и так форсит).
insert into allowed_users (telegram_id, username, group_id, is_admin, added_by) values
  (900000001, 'demo_guest', 'demo', false, 744230399),
  (900000002, 'demo_anna',  'demo', false, 744230399),
  (900000003, 'demo_petr',  'demo', false, 744230399),
  (900000004, 'demo_maria', 'demo', false, 744230399);

insert into user_profiles (telegram_id, first_name, last_name, role, markets) values
  (900000001, 'Demo',   'Guest',    'bd',        array['RS','BG']),
  (900000002, 'Anna',   'Petrova',  'marketing', array['RS','BG']),
  (900000003, 'Peter',  'Ilić',     'rnd',       array['HR','SI']),
  (900000004, 'Maria',  'Popescu',  'bd',        array['RO','PL']);

-- 4. Задачи — разные статусы, страны, исполнители, приоритеты (для доски/спринта/линз).
insert into tasks (title, description, assignees, assignee_telegram_ids, country, task_role, status, priority, due_date, source, confirmed, created_by_telegram_id, group_id) values
  ('Launch summer menu',            'Align items and launch dates with the RS team.',      array['Anna Petrova'],  array[900000002], 'RS', 'marketing', 'open',        'high', (now() + interval '3 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Payments integration (wallet)', 'Connect the provider, test refunds.',                 array['Peter Ilić'],    array[900000003], 'HR', 'rnd',       'in_progress','med',  (now() + interval '7 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Update partner pricing',        null,                                                  array['Maria Popescu'], array[900000004], 'RO', 'bd',        'open',        'med',  (now() + interval '2 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Review Q2 metrics',             'Consolidate CVM/LTV by market, prepare a summary.',   array['Demo Guest'],    array[900000001], 'BG', 'bd',        'open',        null,   (now() + interval '5 days')::date, 'transcript', true, 900000001, 'demo'),
  ('Design promo banners',          'Done, sent to print.',                                array['Anna Petrova'],  array[900000002], 'PL', 'marketing', 'done',        'low',  (now() - interval '2 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Customer churn analysis',       'Build cohorts, find churn points.',                   array['Peter Ilić'],    array[900000003], 'SI', 'rnd',       'in_progress','high', (now() + interval '10 days')::date, 'transcript', true, 900000001, 'demo'),
  ('Negotiate supply deal',         null,                                                  array['Maria Popescu'], array[900000004], 'RS', 'bd',        'open',        null,   null, 'mini_app', true, 900000001, 'demo');

-- 5. Опубликованные встречи (в базе знаний) — тезисы в нашем markdown-формате (TezisyBlocks).
-- Каждая встреча помечена ОДНОЙ страной → дайджест по странам не дублирует контент.
insert into entries (content, summary, added_by, source, entry_type, entry_date, metadata, countries, group_id, is_private) values
  ('Marketing sync — Serbia. Summer menu launch and promo campaign.',
   E'### Summer menu\n- Launches next week, 12 new items.\n- Promo banners ready, sent to print.\n### Budget\n- Launch target increased by 15%.',
   'granola', 'granola', 'meeting', (now() - interval '3 days')::date,
   jsonb_build_object('title','Marketing — Serbia','confirmed',true), array['RS'], 'demo', false),
  ('Bulgaria operations. Supply and a new location opening.',
   E'### Supply\n- Packaging supplier contract renewed for a year.\n- Regional logistics optimized.\n### New location\n- Premises approved, renovation starts in July.',
   'granola', 'granola', 'meeting', (now() - interval '2 days')::date,
   jsonb_build_object('title','Operations — Bulgaria','confirmed',true), array['BG'], 'demo', false),
  ('Product review transcript.',
   E'### Product\n- Payments integration in progress, release in a week.\n- Churn analysis: building cohorts by acquisition channel.\n### Risks\n- Payment provider is delaying documents.',
   'desktop-agent', 'desktop-agent', 'meeting', (now() - interval '1 day')::date,
   jsonb_build_object('title','Product review','confirmed',true), array['HR','SI'], 'demo', false);

-- 6. Заметки в базе знаний (не встречи).
insert into entries (content, summary, added_by, source, entry_type, entry_date, metadata, countries, group_id, is_private) values
  ('New location launch checklist: premises, staff, equipment, marketing, sanitation.',
   E'### Location launch playbook\n- Premises and renovation\n- Hiring and staff training\n- Equipment and supply\n- Local marketing',
   'demo_guest', 'note', 'note', (now() - interval '5 days')::date,
   jsonb_build_object('title','New location launch playbook'), array['General'], 'demo', false);

-- 7. Встреча «на вычитке» (единая приёмная) — показать флоу вычитки/публикации в вебе.
insert into meetings (source, identity_kind, identity_key, title, started_at, attendees, group_id, draft_notes_md, status, recorders) values
  ('granola', 'external', 'granola:demo-planning-q3', 'Q3 planning', (now() - interval '2 hours'),
   '[{"name":"Demo Guest"},{"name":"Anna Petrova"},{"name":"Peter Ilić"}]'::jsonb, 'demo',
   E'### Q3 plans\n- Summer menu launch in RS/BG.\n- Payments integration is the priority.\n### Tasks\n- Consolidate Q2 metrics by Friday.',
   'awaiting_review', '[{"telegram_id":900000001,"role":"transcribe"}]'::jsonb);

commit;
