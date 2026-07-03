-- Demo-воркспейс для показа заказчику. Идемпотентный SEED = RESET к эталону:
-- полностью пересоздаёт группу 'demo' и её данные. Безопасно для прод — трогает ТОЛЬКО
-- group_id='demo' и зашитые demo-telegram_id (900000001..900000004), реальные данные не касаются.
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
  (900000001, 'Гость',  'Demo',       'bd',        array['RS','BG']),
  (900000002, 'Анна',   'Маркетинг',  'marketing', array['RS','BG']),
  (900000003, 'Пётр',   'Продукт',    'rnd',       array['HR','SI']),
  (900000004, 'Мария',  'Развитие',   'bd',        array['RO','PL']);

-- 4. Задачи — разные статусы, страны, исполнители, приоритеты (для доски/спринта/линз).
insert into tasks (title, description, assignees, assignee_telegram_ids, country, task_role, status, priority, due_date, source, confirmed, created_by_telegram_id, group_id) values
  ('Запустить летнее меню',            'Согласовать позиции и сроки старта с командой RS.', array['Анна Маркетинг'], array[900000002], 'RS', 'marketing', 'open',        'high', (now() + interval '3 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Интеграция платежей (кошелёк)',    'Подключить провайдера, протестировать возвраты.',   array['Пётр Продукт'],   array[900000003], 'HR', 'rnd',       'in_progress','med',  (now() + interval '7 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Обновить прайс для партнёров',     null,                                                array['Мария Развитие'], array[900000004], 'RO', 'bd',        'open',        'med',  (now() + interval '2 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Проверить метрики Q2',             'Свести CVM/LTV по рынкам, подготовить сводку.',      array['Гость Demo'],     array[900000001], 'BG', 'bd',        'open',        null,   (now() + interval '5 days')::date, 'transcript', true, 900000001, 'demo'),
  ('Дизайн промо-баннеров',            'Готово, отправлено в печать.',                      array['Анна Маркетинг'], array[900000002], 'PL', 'marketing', 'done',        'low',  (now() - interval '2 days')::date, 'mini_app', true, 900000001, 'demo'),
  ('Анализ оттока клиентов',           'Построить когорты, найти точки оттока.',            array['Пётр Продукт'],   array[900000003], 'SI', 'rnd',       'in_progress','high', (now() + interval '10 days')::date, 'transcript', true, 900000001, 'demo'),
  ('Договориться о поставках',         null,                                                array['Мария Развитие'], array[900000004], 'RS', 'bd',        'open',        null,   null, 'mini_app', true, 900000001, 'demo');

-- 5. Опубликованные встречи (в базе знаний) — тезисы в нашем markdown-формате (TezisyBlocks).
insert into entries (content, summary, added_by, source, entry_type, entry_date, metadata, countries, group_id, is_private) values
  ('Стенограмма синка по маркетингу CEE …',
   E'### Итоги\n- Летнее меню стартует на следующей неделе в Сербии и Болгарии.\n- Промо-баннеры готовы, отправлены в печать.\n### Решения\n- Бюджет на таргет увеличен на 15%.\n- Ответственная — Анна.',
   'granola', 'granola', 'meeting', (now() - interval '3 days')::date,
   jsonb_build_object('title','Синк по маркетингу CEE','confirmed',true), array['RS','BG'], 'demo', false),
  ('Стенограмма продуктового ревью …',
   E'### Продукт\n- Интеграция платежей в работе, релиз через неделю.\n- Анализ оттока: строим когорты.\n### Риски\n- Провайдер платежей задерживает документы.',
   'desktop-agent', 'desktop-agent', 'meeting', (now() - interval '1 day')::date,
   jsonb_build_object('title','Продуктовое ревью','confirmed',true), array['HR','SI'], 'demo', false);

-- 6. Заметки в базе знаний (не встречи).
insert into entries (content, summary, added_by, source, entry_type, entry_date, metadata, countries, group_id, is_private) values
  ('Чек-лист запуска новой точки: помещение, персонал, оборудование, маркетинг, санитария.',
   E'### Регламент запуска точки\n- Помещение и ремонт\n- Найм и обучение персонала\n- Оборудование и поставки\n- Локальный маркетинг',
   'demo_guest', 'note', 'note', (now() - interval '5 days')::date,
   jsonb_build_object('title','Регламент запуска новой точки'), array['General'], 'demo', false);

-- 7. Встреча «на вычитке» (единая приёмная) — показать флоу вычитки/публикации в вебе.
insert into meetings (source, identity_kind, identity_key, title, started_at, attendees, group_id, draft_notes_md, status, recorders) values
  ('granola', 'external', 'granola:demo-planning-q3', 'Планёрка Q3', (now() - interval '2 hours'),
   '[{"name":"Гость Demo"},{"name":"Анна Маркетинг"},{"name":"Пётр Продукт"}]'::jsonb, 'demo',
   E'### Планы на Q3\n- Запуск летнего меню в RS/BG.\n- Интеграция платежей — приоритет.\n### Задачи\n- Свести метрики Q2 до пятницы.',
   'awaiting_review', '[{"telegram_id":900000001,"role":"transcribe"}]'::jsonb);

commit;
