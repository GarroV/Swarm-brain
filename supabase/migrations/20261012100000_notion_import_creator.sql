-- Задачи, залитые из Notion, записаны на ведущую проекта, а не на того, кто их загрузил
-- (решение владельца 12.10.2026, docs/decisions/2026-10-12-notion-import-creator.md).
--
-- Импорт шёл через MCP под токеном владельца, поэтому создателем встал он — и получал
-- уведомления о каждом комментарии к чужим задачам. Создатель теперь ведущая проекта
-- (ведёт «Инициативы качества»), но уведомлений как создатель она не получает: владелец выбрал
-- «ведущая, но без уведомлений». Поэтому ей ставится явный отказ (muted) — только там, где она
-- не исполнитель (исполнитель уведомления получает как раньше) и где у неё ещё нет своей
-- строки подписки (сама подписалась или отписалась — её выбор не перетираем).
--
-- Набор задач — два пакетных импорта, узнаются по источнику и окну времени:
--   09.10.2026 13:18–13:31 UTC, source='claude' — перенос плана из Notion;
--   01.10.2026 10:53–10:56 UTC, source='manual' — первая заливка тех же инициатив.
-- Если строк нет (чистая база, демо) — миграция ничего не делает.

DO $$
DECLARE
  v_owner  constant bigint := 744230399;   -- кто загружал
  v_lead   constant bigint := 507931827;   -- ведущая проекта
  v_moved  integer;
  v_muted  integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.allowed_users WHERE telegram_id = v_lead) THEN
    RAISE NOTICE 'notion_import_creator: ведущей нет в allowed_users — пропуск';
    RETURN;
  END IF;

  CREATE TEMP TABLE _import_tasks ON COMMIT DROP AS
    SELECT id, assignee_telegram_ids
      FROM public.tasks
     WHERE created_by_telegram_id = v_owner
       AND group_id = 'cee'
       AND (
             (source = 'claude' AND created_at >= '2026-10-09 13:18:00+00' AND created_at < '2026-10-09 13:31:00+00')
          OR (source = 'manual' AND created_at >= '2026-10-01 10:53:00+00' AND created_at < '2026-10-01 10:56:00+00')
           );

  UPDATE public.tasks t
     SET created_by_telegram_id = v_lead
    FROM _import_tasks i
   WHERE t.id = i.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  INSERT INTO public.task_subscriptions (task_id, telegram_id, state, reason)
  SELECT i.id, v_lead, 'muted', 'manual'
    FROM _import_tasks i
   WHERE NOT (v_lead = ANY (coalesce(i.assignee_telegram_ids, '{}')))
  ON CONFLICT (task_id, telegram_id) DO NOTHING;
  GET DIAGNOSTICS v_muted = ROW_COUNT;

  RAISE NOTICE 'notion_import_creator: создатель сменён у % задач, уведомления выключены у %', v_moved, v_muted;
END $$;
