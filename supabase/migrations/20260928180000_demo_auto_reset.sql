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

  -- Демо-люди = эталонные + все, кого занесли в воркспейс demo сверх них.
  select coalesce(pg_catalog.array_agg(distinct u), '{}')
    into v_users
    from (select pg_catalog.unnest(c_users) as u
          union
          select telegram_id from public.allowed_users where group_id = c_ws) s
   where u is not null;

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
  delete from public.feedback           where telegram_id = any (v_users);
  delete from public.user_integrations  where telegram_id = any (v_users);
  delete from public.recorder_diagnostics where telegram_id = any (v_users);
  delete from public.sessions           where chat_id = any (v_users);
  delete from public.user_profiles      where telegram_id = any (v_users);
  -- Лишние люди воркспейса (не эталонные) — их строки в демо уже снесены выше.
  delete from public.allowed_users
   where group_id = c_ws and not (telegram_id = any (c_users));

  -- ── 2. Воркспейс и команда ──────────────────────────────────────────────────────────────
  insert into public.workspaces (id, name, allowed_markets)
  values (c_ws, 'Demo Workspace', null)
  on conflict (id) do update set name = excluded.name, allowed_markets = null;

  -- Гость-заказчик (900000001, в него входит демо-ссылка) и выдуманная команда. У всех
  -- is_admin=false — барьер isDemo и так форсит, но эталон не должен на это полагаться.
  -- Токены MCP и рекордера, e-mail и следы рекордера обнуляются: посетитель мог их завести.
  insert into public.allowed_users as a
         (telegram_id, username, group_id, is_admin, added_by)
  values (900000001, 'demo',  c_ws, false, 744230399),
         (900000002, 'maya',  c_ws, false, 744230399),
         (900000003, 'tom',   c_ws, false, 744230399),
         (900000004, 'ines',  c_ws, false, 744230399),
         (900000005, 'karl',  c_ws, false, 0),
         (900000006, 'sofia', c_ws, false, 0),
         (900000007, 'nils',  c_ws, false, 0)  -- без задач: фильтр обязан показывать и таких
  on conflict (telegram_id) do update
     set username = excluded.username, group_id = excluded.group_id, is_admin = false,
         added_by = excluded.added_by, email = null,
         claude_mcp_token_hash = null, claude_mcp_token_expires_at = null,
         recorder_token_hash = null, recorder_token_expires_at = null,
         recorder_token_prev_hash = null, recorder_token_prev_expires_at = null,
         recorder_last_seen = null, recorder_last_recording = null,
         recorder_last_version = null, recorder_expiry_warned = false,
         recorder_last_on_call = null, recorder_last_meeting_key = null;

  -- Имена живут в user_profiles, а не в allowed_users: без профиля фильтр показал бы логин.
  insert into public.user_profiles (telegram_id, first_name, last_name, role, markets) values
    (900000001, 'Demo',  'Guest',     'bd',        array['RS','BG']),
    (900000002, 'Maya',  'Lindqvist', 'marketing', array['RS','BG']),
    (900000003, 'Tom',   'Farrow',    'rnd',       array['HR','SI']),
    (900000004, 'Ines',  'Duarte',    'bd',        array['RO','PL']),
    (900000005, 'Karl',  'Brenner',   null,        '{}'),
    (900000006, 'Sofia', 'Rinaldi',   null,        '{}'),
    (900000007, 'Nils',  'Berg',      null,        '{}');

  -- ── 3. Задачи общего списка (доска, линзы, страны) ──────────────────────────────────────
  -- Данные ВЫДУМАНЫ и по-английски: демо смотрит внешний человек, а demo-сессия рендерит UI
  -- по-английски. Даты считаются от сегодня — демо с прошлогодними датами выглядит мёртвым.
  insert into public.tasks (title, description, assignees, assignee_telegram_ids, country, task_role,
                            status, priority, due_date, source, confirmed, created_by_telegram_id, group_id)
  values
    ('Launch summer menu',            'Align items and launch dates with the RS team.',    array['Anna Petrova'],  array[900000002]::bigint[], 'RS', 'marketing', 'open',        'high', current_date + 3,  'mini_app',   true, 900000001, c_ws),
    ('Payments integration (wallet)', 'Connect the provider, test refunds.',               array['Peter Ilić'],    array[900000003]::bigint[], 'HR', 'rnd',       'in_progress', 'med',  current_date + 7,  'mini_app',   true, 900000001, c_ws),
    ('Update partner pricing',        null,                                                array['Maria Popescu'], array[900000004]::bigint[], 'RO', 'bd',        'open',        'med',  current_date + 2,  'mini_app',   true, 900000001, c_ws),
    ('Review Q2 metrics',             'Consolidate CVM/LTV by market, prepare a summary.', array['Demo Guest'],    array[900000001]::bigint[], 'BG', 'bd',        'open',        null,   current_date + 5,  'transcript', true, 900000001, c_ws),
    ('Design promo banners',          'Done, sent to print.',                              array['Anna Petrova'],  array[900000002]::bigint[], 'PL', 'marketing', 'done',        'low',  current_date - 2,  'mini_app',   true, 900000001, c_ws),
    ('Customer churn analysis',       'Build cohorts, find churn points.',                 array['Peter Ilić'],    array[900000003]::bigint[], 'SI', 'rnd',       'in_progress', 'high', current_date + 10, 'transcript', true, 900000001, c_ws),
    ('Negotiate supply deal',         null,                                                array['Maria Popescu'], array[900000004]::bigint[], 'RS', 'bd',        'open',        null,   null,              'mini_app',   true, 900000001, c_ws);

  -- ── 4. База знаний: опубликованные встречи (по одной стране) и заметка ─────────────────
  insert into public.entries (content, summary, added_by, source, entry_type, entry_date, metadata,
                              countries, group_id, is_private)
  values
    ('Marketing sync — Serbia. Summer menu launch and promo campaign.',
     E'### Summer menu\n- Launches next week, 12 new items.\n- Promo banners ready, sent to print.\n### Budget\n- Launch target increased by 15%.',
     'granola', 'granola', 'meeting', current_date - 3,
     pg_catalog.jsonb_build_object('title', 'Marketing — Serbia', 'confirmed', true), array['RS'], c_ws, false),
    ('Bulgaria operations. Supply and a new location opening.',
     E'### Supply\n- Packaging supplier contract renewed for a year.\n- Regional logistics optimized.\n### New location\n- Premises approved, renovation starts in July.',
     'granola', 'granola', 'meeting', current_date - 2,
     pg_catalog.jsonb_build_object('title', 'Operations — Bulgaria', 'confirmed', true), array['BG'], c_ws, false),
    ('Product review transcript.',
     E'### Product\n- Payments integration in progress, release in a week.\n- Churn analysis: building cohorts by acquisition channel.\n### Risks\n- Payment provider is delaying documents.',
     'desktop-agent', 'desktop-agent', 'meeting', current_date - 1,
     pg_catalog.jsonb_build_object('title', 'Product review', 'confirmed', true), array['HR','SI'], c_ws, false),
    ('New location launch checklist: premises, staff, equipment, marketing, sanitation.',
     E'### Location launch playbook\n- Premises and renovation\n- Hiring and staff training\n- Equipment and supply\n- Local marketing',
     'demo_guest', 'note', 'note', current_date - 5,
     pg_catalog.jsonb_build_object('title', 'New location launch playbook'), array['General'], c_ws, false);

  -- Встреча «на вычитке» — показать флоу вычитки и публикации.
  insert into public.meetings (source, identity_kind, identity_key, title, started_at, attendees,
                               group_id, draft_notes_md, status, recorders)
  values ('granola', 'external', 'granola:demo-planning-q3', 'Q3 planning', now() - interval '2 hours',
          '[{"name":"Demo Guest"},{"name":"Anna Petrova"},{"name":"Peter Ilić"}]'::jsonb, c_ws,
          E'### Q3 plans\n- Summer menu launch in RS/BG.\n- Payments integration is the priority.\n### Tasks\n- Consolidate Q2 metrics by Friday.',
          'awaiting_review', '[{"telegram_id":900000001,"role":"transcribe"}]'::jsonb);

  -- ── 5. Доска инициатив: вкладка, пространство спринтов, направления, инициативы ─────────
  -- Вкладка доски «Проекты» и пространство раздела «Спринты» — РАЗНЫЕ записи таблицы sprints
  -- (поле kind, issue #423). Фиксированные UUID: на них ссылаются спринты и задачи ниже.
  insert into public.sprints (id, group_id, name, start_date, end_date, status, kind) values
    ('d0000000-0000-4000-8000-000000000001', c_ws, 'Store Experience', current_date - 90, current_date + 90, 'active', 'board_tab'),
    ('d0000000-0000-4000-8000-000000000002', c_ws, 'Store Experience', current_date,      current_date,      'active', 'space');

  -- Направления (верхний уровень, держат вкладку) и инициативы (подпроекты).
  insert into public.projects (id, group_id, name, emoji, sprint_id, parent_id,
                               owner_telegram_id, start_date, end_date, is_private, created_by)
  values
    ('d0000000-0000-4000-8000-000000000101', c_ws, 'Operations', '🍕', 'd0000000-0000-4000-8000-000000000001', null, null, null, null, false, null),
    ('d0000000-0000-4000-8000-000000000102', c_ws, 'Technology', '⚙️', 'd0000000-0000-4000-8000-000000000001', null, null, null, null, false, null),
    ('d0000000-0000-4000-8000-000000000103', c_ws, 'People',     '👥', 'd0000000-0000-4000-8000-000000000001', null, null, null, null, false, null),
    ('d0000000-0000-4000-8000-000000000111', c_ws, 'Kitchen Flow',     null, null, 'd0000000-0000-4000-8000-000000000101', null, current_date - 60, current_date + 30, false, null),
    ('d0000000-0000-4000-8000-000000000112', c_ws, 'Supplier Audit',   null, null, 'd0000000-0000-4000-8000-000000000101', null, current_date - 20, current_date - 2,  false, null),
    ('d0000000-0000-4000-8000-000000000113', c_ws, 'Order App',        null, null, 'd0000000-0000-4000-8000-000000000102', null, current_date - 45, current_date + 45, false, null),
    ('d0000000-0000-4000-8000-000000000114', c_ws, 'Store Dashboards', null, null, 'd0000000-0000-4000-8000-000000000102', null, current_date - 10, current_date + 60, false, null),
    ('d0000000-0000-4000-8000-000000000115', c_ws, 'Shift Training',   null, null, 'd0000000-0000-4000-8000-000000000103', null, current_date - 30, current_date + 15, false, null);

  -- Задачи доски. Статусы покрывают всё, что умеет показать доска, включая cancelled
  -- (отменённое стоит вне процента).
  insert into public.tasks (id, group_id, title, assignees, assignee_telegram_ids, status, due_date,
                            project_id, project_linked, source, created_by, confirmed, is_private, links)
  values
    ('d0000000-0000-4000-8000-000000000201', c_ws, 'Cut ticket time at peak hours',      array['Maya Lindqvist'],               '{}', 'in_progress', current_date + 3,  'd0000000-0000-4000-8000-000000000111', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000202', c_ws, 'Rewrite the prep checklist',         array['Tom Farrow'],                   '{}', 'done',        current_date - 4,  'd0000000-0000-4000-8000-000000000111', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000203', c_ws, 'Map the dough line bottleneck',      array['Maya Lindqvist','Karl Brenner'], '{}', 'open',        current_date + 9,  'd0000000-0000-4000-8000-000000000111', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000204', c_ws, 'Collect supplier quality reports',   array['Ines Duarte'],                  '{}', 'done',        current_date - 8,  'd0000000-0000-4000-8000-000000000112', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000205', c_ws, 'Agree the audit scorecard',          array['Ines Duarte'],                  '{}', 'in_progress', current_date - 1,  'd0000000-0000-4000-8000-000000000112', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000206', c_ws, 'Ship one-tap reorder',               array['Sofia Rinaldi'],                '{}', 'in_progress', current_date + 5,  'd0000000-0000-4000-8000-000000000113', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000207', c_ws, 'Fix address autocomplete on mobile', array['Sofia Rinaldi'],                '{}', 'done',        current_date - 6,  'd0000000-0000-4000-8000-000000000113', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000208', c_ws, 'Drop the legacy payment screen',     array['Karl Brenner'],                 '{}', 'cancelled',   current_date - 2,  'd0000000-0000-4000-8000-000000000113', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-000000000209', c_ws, 'Draft the store health dashboard',   array['Karl Brenner'],                 '{}', 'open',        current_date + 12, 'd0000000-0000-4000-8000-000000000114', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-00000000020a', c_ws, 'Pick the metrics that matter',       '{}',                                  '{}', 'open',        null,              'd0000000-0000-4000-8000-000000000114', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-00000000020b', c_ws, 'Run the first shift-lead workshop',  array['Tom Farrow'],                   '{}', 'done',        current_date - 12, 'd0000000-0000-4000-8000-000000000115', true, 'demo', 'demo', true, false, '[]'),
    ('d0000000-0000-4000-8000-00000000020c', c_ws, 'Record the onboarding videos',       array['Tom Farrow'],                   '{}', 'in_progress', current_date - 3,  'd0000000-0000-4000-8000-000000000115', true, 'demo', 'demo', true, false, '[]'),
    -- Задача прямо на направлении, без инициативы: доска обязана показать и такую.
    ('d0000000-0000-4000-8000-00000000020d', c_ws, 'Agree the quarterly store targets',  array['Maya Lindqvist'],               '{}', 'open',        current_date + 20, 'd0000000-0000-4000-8000-000000000103', true, 'demo', 'demo', true, false, '[]');

  -- ── 6. Спринты: принятый (итоги записаны на приёмке) и живой (один на пространство) ────
  insert into public.sprint_cycles (id, group_id, tab_id, name, start_date, end_date, check_date,
                                    status, created_by, started_at, accepted_at, accepted_by, summary, stats)
  values
    ('d0000000-0000-4000-8000-000000000301', c_ws, 'd0000000-0000-4000-8000-000000000002',
     'Sprint 12', current_date - 28, current_date - 15, current_date - 21, 'accepted',
     'demo', (current_date - 28)::timestamptz, (current_date - 15)::timestamptz, 'demo',
     'Prep checklist rewritten, supplier reports collected. Audit scorecard slipped a week.',
     '{"planned":5,"planDone":3,"planPercent":60,"extra":1,"extraDone":1,"carried":2,"cancelled":0}'::jsonb),
    ('d0000000-0000-4000-8000-000000000302', c_ws, 'd0000000-0000-4000-8000-000000000002',
     'Sprint 13', current_date - 6, current_date + 7, current_date - 1, 'active',
     'demo', (current_date - 6)::timestamptz, null, null, null, null);

  -- Состав принятого спринта — с замороженным снимком (после приёмки доска показывает клон).
  insert into public.sprint_items (id, cycle_id, task_id, in_plan, added_by, frozen_at, frozen_title,
                                   frozen_status, frozen_assignees, frozen_project, frozen_due_date,
                                   check_status, to_carry, carry_reason, carry_count)
  values
    ('d0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000202', true,  'demo', (current_date - 15)::timestamptz, 'Rewrite the prep checklist',         'done',        array['Tom Farrow'],     'Kitchen Flow',   current_date - 16, 'ok',      false, null, 0),
    ('d0000000-0000-4000-8000-000000000402', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000204', true,  'demo', (current_date - 15)::timestamptz, 'Collect supplier quality reports',   'done',        array['Ines Duarte'],    'Supplier Audit', current_date - 18, 'ok',      false, null, 0),
    ('d0000000-0000-4000-8000-000000000403', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000207', true,  'demo', (current_date - 15)::timestamptz, 'Fix address autocomplete on mobile', 'done',        array['Sofia Rinaldi'],  'Order App',      current_date - 17, 'ok',      false, null, 0),
    ('d0000000-0000-4000-8000-000000000404', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000205', true,  'demo', (current_date - 15)::timestamptz, 'Agree the audit scorecard',          'in_progress', array['Ines Duarte'],    'Supplier Audit', current_date - 15, 'risk',    true,  'Waiting for the supplier to confirm the scoring', 0),
    ('d0000000-0000-4000-8000-000000000405', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000201', true,  'demo', (current_date - 15)::timestamptz, 'Cut ticket time at peak hours',      'in_progress', array['Maya Lindqvist'], 'Kitchen Flow',   current_date - 15, 'problem', true,  'Blocked by the oven replacement schedule', 0),
    -- Взято сверх плана и закрыто: план и «сверх плана» считаются отдельно.
    ('d0000000-0000-4000-8000-000000000406', 'd0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-00000000020b', false, 'demo', (current_date - 15)::timestamptz, 'Run the first shift-lead workshop',  'done',        array['Tom Farrow'],     'Shift Training', current_date - 20, 'ok',      false, null, 0);

  -- Состав живого спринта: отметки сверки, переносы с историей («×2») и упоминание удалённой
  -- задачи (иначе состав спринта задним числом становится меньше, чем был).
  insert into public.sprint_items (id, cycle_id, task_id, in_plan, added_by, check_status, check_note,
                                   check_at, check_by, to_carry, carry_reason, carried_from,
                                   carried_manual, carry_count, removed_title, removed_project_id, removed_at)
  values
    ('d0000000-0000-4000-8000-000000000411', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000205', true,  'demo', 'risk',    'Supplier still silent, chasing by phone',             (current_date - 1)::timestamptz, 'Ines Duarte',    false, null, 'd0000000-0000-4000-8000-000000000404', false, 1, null, null, null),
    ('d0000000-0000-4000-8000-000000000412', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000201', true,  'demo', 'problem', 'Oven arrives next month, nothing to measure until then', (current_date - 1)::timestamptz, 'Maya Lindqvist', true, 'Nothing moves before the oven is in', 'd0000000-0000-4000-8000-000000000405', false, 2, null, null, null),
    ('d0000000-0000-4000-8000-000000000413', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000206', true,  'demo', 'ok',      null, (current_date - 1)::timestamptz, 'Sofia Rinaldi', false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000414', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000020c', true,  'demo', null,      null, null, null, false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000415', 'd0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000209', false, 'demo', 'ok',      null, (current_date - 1)::timestamptz, 'Karl Brenner', false, null, null, null, 0, null, null, null),
    ('d0000000-0000-4000-8000-000000000416', 'd0000000-0000-4000-8000-000000000302', null, true, 'demo', null, null, null, null, false, null, null, null, 0,
     'Pilot the self-order kiosk', 'd0000000-0000-4000-8000-000000000113', (current_date - 2)::timestamptz);

  -- Что получилось — числами, а не словом «готово»: сброс, который ничего не записал, выглядит
  -- успешным ровно так же, как сброс, который записал всё.
  select pg_catalog.jsonb_build_object(
           'users',    (select count(*) from public.allowed_users where group_id = c_ws),
           'tasks',    (select count(*) from public.tasks         where group_id = c_ws),
           'entries',  (select count(*) from public.entries       where group_id = c_ws),
           'meetings', (select count(*) from public.meetings      where group_id = c_ws),
           'spaces',   (select count(*) from public.sprints       where group_id = c_ws),
           'projects', (select count(*) from public.projects      where group_id = c_ws),
           'cycles',   (select count(*) from public.sprint_cycles where group_id = c_ws))
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
