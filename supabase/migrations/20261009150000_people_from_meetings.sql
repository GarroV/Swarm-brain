-- Участники встреч — в справочник людей воркспейса (#887, первый пункт).
-- Канон: docs/decisions/2026-10-08-people-stickers-ratings-mail.md, раздел 1, пункт (б):
-- «участник встречи — по e-mail, если такого ещё нет (переговорки отсекаются, как в meeting-access.ts)».
-- Владелец 09.10: «Справочник участников встреч нужен… надо сейчас доделывать».
--
-- Что делает:
--   people.last_met_at          — последняя встреча с этим человеком в воркспейсе. По ней поле
--                                 «Исполнитель»/«Соисполнители» показывает недавних людей первыми.
--   people_from_attendees(...)  — участники с почтой, которых в воркспейсе ещё нет, заводятся
--                                 (source='calendar'); у всех найденных и заведённых, включая
--                                 аккаунты, двигается last_met_at.
--   meeting_is_public(...)      — встреча видна всему воркспейсу: опубликована в ОБЩУЮ базу.
--   trg_meetings_people         — зовёт функцию, когда встреча становится общей или у общей
--                                 меняются участники (рекордер дописывает их UPDATE-ом).
--   trg_entries_people          — запись встречи переведена из личных в общие.
--   бэкфилл                     — все нынешние общие встречи по возрастанию времени.
--
-- ПРИВАТНОСТЬ. Справочник (GET /people) видит весь воркспейс, поэтому в него и в last_met_at идут
-- только участники встреч, которые и так видны всем: status='in_base' и запись в entries
-- с is_private=false. Черновик на вычитке видит только записавший (meeting-access.ts), личную
-- встречу или встречу 1-1 «на двоих» — только владелец (без обхода админом, решение 07.08):
-- их участники в справочник не попадают, иначе «с кем и когда встречался» стало бы видно всем.
-- Встреча стала личной позже — уже заведённых людей не трогаем (они могли прийти из других
-- встреч), новые от неё не заводятся. Совпадает с каноном (б): «участник встречи при публикации».
--
-- Только новые колонка, функции и триггер; существующие строки people меняются лишь в last_met_at.
-- Откат — снести триггер; колонка и заведённые люди никому не мешают.

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS last_met_at timestamptz;

COMMENT ON COLUMN public.people.last_met_at IS
  'Последняя встреча с человеком в воркспейсе (из meetings.attendees, триггер trg_meetings_people).';

-- ── Участники одной встречи → люди воркспейса ──────────────────────────────────────────────
-- Мусор на входе (null, не массив, элемент не объект, почта не строка или без «@») пропускается,
-- а не роняет вызов: attendees приходят из календарей и клиентов, которые мы не контролируем.
-- Переговорка — флаг resource ИЛИ домен ресурсов Google: флаг приходит не всегда (на проде
-- 09.10 — 10 переговорок без него). То же правило, что isRoom в _shared/meeting-access.ts.
CREATE OR REPLACE FUNCTION public.people_from_attendees(p_group text, p_attendees jsonb, p_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_emails text[];
  v_names  text[];
BEGIN
  IF p_group IS NULL OR p_attendees IS NULL OR jsonb_typeof(p_attendees) <> 'array' THEN
    RETURN;
  END IF;

  -- Одна почта — один человек; из нескольких записей одной почты берём первую с непустым именем.
  SELECT array_agg(email ORDER BY email), array_agg(name ORDER BY email)
    INTO v_emails, v_names
    FROM (
      SELECT DISTINCT ON (email) email, name
        FROM (
          SELECT lower(btrim(a ->> 'email')) AS email,
                 nullif(btrim(a ->> 'name'), '') AS name,
                 ord
            FROM jsonb_array_elements(p_attendees) WITH ORDINALITY AS t(a, ord)
           WHERE jsonb_typeof(a) = 'object'
             AND jsonb_typeof(a -> 'email') = 'string'
             AND coalesce(a ->> 'resource', '') <> 'true'
        ) raw
       WHERE email LIKE '%_@_%'
         AND email NOT LIKE '%@resource.calendar.google.com'
       ORDER BY email, (name IS NULL), ord
    ) att;

  IF v_emails IS NULL THEN
    RETURN;
  END IF;

  -- Нет человека с такой почтой (не в архиве) — заводим. Повтор и гонку двух записей одной
  -- встречи гасит частичный уникальный индекс people_group_email_uq.
  INSERT INTO public.people (group_id, display_name, email, source, last_met_at)
  SELECT p_group,
         left(coalesce(att.name, nullif(split_part(att.email, '@', 1), ''), att.email), 120),
         att.email, 'calendar', p_at
    FROM unnest(v_emails, v_names) AS att(email, name)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.people p
      WHERE p.group_id = p_group AND p.email = att.email AND p.archived_at IS NULL
   )
  ON CONFLICT DO NOTHING;

  -- Последняя встреча — у всех участников с записью, в том числе у аккаунтов. Пишем только
  -- когда дата и правда сдвинулась: рекордер переписывает участников на каждом claim.
  UPDATE public.people p
     SET last_met_at = p_at
   WHERE p.group_id = p_group
     AND p.email = ANY (v_emails)
     AND p.archived_at IS NULL
     AND p_at IS NOT NULL
     AND (p.last_met_at IS NULL OR p.last_met_at < p_at);
END $$;

-- ── Встреча видна всему воркспейсу? ───────────────────────────────────────────────────────
-- Только опубликованная в общую базу своего воркспейса. Всё остальное (черновик, личная запись,
-- запись на двоих, запись другого воркспейса, запись не найдена) — нет.
CREATE OR REPLACE FUNCTION public.meeting_is_public(p_group text, p_status text, p_entry uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_group IS NOT NULL AND p_status = 'in_base' AND p_entry IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.entries e
        WHERE e.id = p_entry AND e.group_id = p_group AND e.is_private = false
     );
$$;

-- ── Триггер встречи ────────────────────────────────────────────────────────────────────────
-- Почему ошибка гасится (EXCEPTION → WARNING), а не роняет запись: встреча — критичный путь
-- рекордера, и её потеря (транскрипт, claim, тезисы) несравнимо дороже недозаведённого человека.
-- Справочник догоняется сам — следующая запись участников этой или другой встречи повторит
-- вызов. Сбой при этом не молчаливый: WARNING с текстом ошибки и id встречи ложится в журнал
-- Postgres (get_logs / query_logs, поиск по «people_from_attendees»).
CREATE OR REPLACE FUNCTION public.meetings_people_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.attendees IS NOT DISTINCT FROM OLD.attendees
     AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.entry_id IS NOT DISTINCT FROM OLD.entry_id THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF NOT public.meeting_is_public(NEW.group_id, NEW.status, NEW.entry_id) THEN
      RETURN NULL;
    END IF;
    PERFORM public.people_from_attendees(NEW.group_id, NEW.attendees, coalesce(NEW.started_at, NEW.created_at));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'people_from_attendees: встреча % (воркспейс %) — люди не заведены: % [%]',
      NEW.id, NEW.group_id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_meetings_people ON public.meetings;
CREATE TRIGGER trg_meetings_people
  AFTER INSERT OR UPDATE OF attendees, group_id, status, entry_id ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.meetings_people_sync();

-- ── Запись встречи стала общей (личная → общая) ─────────────────────────────────────────────
-- Публикация сама заходит через триггер встречи (UPDATE entry_id/status); здесь — поздний
-- перевод уже опубликованной записи в общие. Ошибка гасится по той же причине, что выше.
CREATE OR REPLACE FUNCTION public.entries_people_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  m record;
BEGIN
  BEGIN
    FOR m IN
      SELECT mt.group_id, mt.attendees, coalesce(mt.started_at, mt.created_at) AS at
        FROM public.meetings mt
       WHERE mt.entry_id = NEW.id
         AND public.meeting_is_public(mt.group_id, mt.status, mt.entry_id)
    LOOP
      PERFORM public.people_from_attendees(m.group_id, m.attendees, m.at);
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'people_from_attendees: запись % — люди не заведены: % [%]', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_entries_people ON public.entries;
CREATE TRIGGER trg_entries_people
  AFTER UPDATE OF is_private ON public.entries
  FOR EACH ROW
  WHEN (OLD.is_private AND NOT NEW.is_private)
  EXECUTE FUNCTION public.entries_people_sync();

-- Снаружи (anon через /rest/v1/rpc) — нельзя. Грант на PUBLIC наследуется в anon, снимаем с PUBLIC.
REVOKE ALL ON FUNCTION public.people_from_attendees(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meetings_people_sync() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.entries_people_sync() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meeting_is_public(text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
-- Триггер срабатывает от роли, которая пишет встречу (приложение — service_role): без EXECUTE
-- функция падала бы, и (из-за EXCEPTION выше) справочник молча не пополнялся бы.
GRANT EXECUTE ON FUNCTION public.people_from_attendees(text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.meetings_people_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.entries_people_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.meeting_is_public(text, text, uuid) TO service_role;

-- ── Бэкфилл: все нынешние ОБЩИЕ встречи, от старых к новым ────────────────────────────────
-- От старых к новым — чтобы имя человека бралось из первой встречи, а last_met_at сошёлся на
-- последней. Встречи с воркспейсом, которого нет, пропускаются (внешний ключ people упал бы).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT m.group_id, m.attendees, coalesce(m.started_at, m.created_at) AS at
      FROM public.meetings m
      JOIN public.workspaces w ON w.id = m.group_id
     WHERE jsonb_typeof(m.attendees) = 'array' AND jsonb_array_length(m.attendees) > 0
       AND public.meeting_is_public(m.group_id, m.status, m.entry_id)
     ORDER BY coalesce(m.started_at, m.created_at), m.id
  LOOP
    PERFORM public.people_from_attendees(r.group_id, r.attendees, r.at);
  END LOOP;
END $$;
