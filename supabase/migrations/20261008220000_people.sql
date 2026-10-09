-- Справочник людей воркспейса: люди без аккаунта и соисполнители задачи (#874).
-- Канон: docs/decisions/2026-10-08-people-stickers-ratings-mail.md, раздел 1.
--
-- Владелец 08.10: «нам нужно будет явно завести фейковых… коллег… на него можно наставить задачи…
-- ставить, как соисполнителя, либо исполнителя» и «в самой задаче дать возможность добавлять
-- соисполнителя, и он соответственно утекает в базу и в будущем уже можно подставить по списку».
--
-- Модель:
--   people                — один человек воркспейса. С аккаунтом (account_id → allowed_users.id)
--                           или без (account_id NULL — «фантом»). Аккаунтам запись заводит триггер.
--   tasks.assignee_person_id     — исполнитель БЕЗ аккаунта. Исполнитель с аккаунтом по-прежнему
--                                  живёт в assignee_telegram_ids: бот, MCP, напоминания и права
--                                  читают его оттуда и не меняются. Инвариант держит триггер:
--                                  есть assignee_telegram_ids → assignee_person_id = NULL.
--   tasks.coassignee_person_ids  — соисполнители (ссылки на people, аккаунты и фантомы вперемешку).
--   tasks.coassignee_telegram_ids — производная колонка для «Мои задачи»: telegram_id тех
--                                  соисполнителей, у кого есть аккаунт. Пишет только триггер.
--
-- Человек без аккаунта вошёл (у его allowed_users появился telegram_id, или он вошёл с почтой,
-- которая уже есть в people) → запись связывается с аккаунтом, его задачи переезжают в
-- assignee_telegram_ids и попадают в «Мои задачи» сами.
--
-- Только новые таблица, колонки и триггеры: существующие задачи не меняются. Откат — снести
-- триггеры; колонки и таблица никому не мешают.

CREATE TABLE IF NOT EXISTS public.people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     text NOT NULL REFERENCES public.workspaces(id),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  email        text CHECK (email IS NULL OR (email = lower(btrim(email)) AND email LIKE '%_@_%')),
  account_id   bigint UNIQUE REFERENCES public.allowed_users(id) ON DELETE SET NULL,
  source       text NOT NULL CHECK (source IN ('account', 'calendar', 'manual', 'transcript')),
  created_by   bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);

-- Одна почта — один человек в воркспейсе (по ней связываемся с календарём и со входом Google).
CREATE UNIQUE INDEX IF NOT EXISTS people_group_email_uq
  ON public.people (group_id, email) WHERE email IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS people_group_idx ON public.people (group_id) WHERE archived_at IS NULL;

-- Внешний замок, как у всех таблиц public (#41): политик нет, ходит только service_role.
-- Права выдаём явно: на проде их даёт default ACL, а на свежем контуре Supabase CLI — нет
-- (стенд 09.10.2026: service_role получил только Dxtm, и /people отвечал permission denied).
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.people FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO service_role;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee_person_id uuid
  REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS coassignee_person_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS coassignee_telegram_ids bigint[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS tasks_coassignee_tg_idx ON public.tasks USING gin (coassignee_telegram_ids);
CREATE INDEX IF NOT EXISTS tasks_assignee_person_idx ON public.tasks (assignee_person_id)
  WHERE assignee_person_id IS NOT NULL;

-- ── Задача: инвариант исполнителя и производная колонка соисполнителей ─────────────────────
CREATE OR REPLACE FUNCTION public.tasks_people_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF cardinality(coalesce(NEW.assignee_telegram_ids, '{}')) > 0 THEN
    NEW.assignee_person_id := NULL;
  END IF;
  NEW.coassignee_person_ids := coalesce(NEW.coassignee_person_ids, '{}');
  SELECT coalesce(array_agg(DISTINCT au.telegram_id), '{}')
    INTO NEW.coassignee_telegram_ids
    FROM public.people p
    JOIN public.allowed_users au ON au.id = p.account_id
   WHERE p.id = ANY (NEW.coassignee_person_ids)
     AND au.telegram_id IS NOT NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_people_sync ON public.tasks;
CREATE TRIGGER trg_tasks_people_sync
  BEFORE INSERT OR UPDATE OF assignee_telegram_ids, assignee_person_id, coassignee_person_ids
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_people_sync();

-- ── Человек получил вход: его задачи переезжают на аккаунт ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.people_link_tasks(p_person uuid, p_telegram bigint)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.tasks
     SET assignee_telegram_ids = ARRAY[p_telegram]
   WHERE assignee_person_id = p_person
     AND cardinality(assignee_telegram_ids) = 0;
  -- Пересчитать coassignee_telegram_ids делает триггер задачи: достаточно «тронуть» колонку.
  UPDATE public.tasks
     SET coassignee_person_ids = coassignee_person_ids
   WHERE p_person = ANY (coassignee_person_ids);
END $$;

-- ── Аккаунт → человек: завести, связать по почте, связать задачи при первом входе ─────────────
CREATE OR REPLACE FUNCTION public.people_sync_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_email text := nullif(lower(btrim(NEW.email)), '');
  v_pid   uuid;
BEGIN
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_pid FROM public.people WHERE account_id = NEW.id;
  IF v_pid IS NULL AND v_email IS NOT NULL AND v_email LIKE '%_@_%' THEN
    -- Человек без входа с этой почтой (завели вручную или из календаря) — это он и есть.
    UPDATE public.people
       SET account_id = NEW.id
     WHERE group_id = NEW.group_id AND email = v_email
       AND account_id IS NULL AND archived_at IS NULL
    RETURNING id INTO v_pid;
  END IF;

  IF v_pid IS NULL THEN
    INSERT INTO public.people (group_id, display_name, email, account_id, source, created_by)
    VALUES (
      NEW.group_id,
      left(coalesce(nullif(btrim(NEW.username), ''), v_email, NEW.telegram_id::text, 'участник'), 120),
      CASE WHEN v_email LIKE '%_@_%' THEN v_email END,
      NEW.id, 'account', NEW.added_by
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_pid;
  ELSE
    UPDATE public.people SET group_id = NEW.group_id
     WHERE id = v_pid AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;

  IF v_pid IS NOT NULL AND NEW.telegram_id IS NOT NULL THEN
    PERFORM public.people_link_tasks(v_pid, NEW.telegram_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_people_sync_account ON public.allowed_users;
CREATE TRIGGER trg_people_sync_account
  AFTER INSERT OR UPDATE OF telegram_id, email, group_id ON public.allowed_users
  FOR EACH ROW EXECUTE FUNCTION public.people_sync_account();

-- Функции зовут только триггеры: снаружи (anon через /rest/v1/rpc) — нельзя.
-- Грант на PUBLIC наследуется в anon, поэтому снимаем именно с PUBLIC.
REVOKE ALL ON FUNCTION public.people_link_tasks(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.people_sync_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tasks_people_sync() FROM PUBLIC, anon, authenticated;
-- Триггеры срабатывают от роли, которая пишет строку: приложение пишет под service_role, и без
-- EXECUTE вставка в allowed_users падала бы целиком (поймано живым прогоном на стенде 09.10).
GRANT EXECUTE ON FUNCTION public.people_link_tasks(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.people_sync_account() TO service_role;
GRANT EXECUTE ON FUNCTION public.tasks_people_sync() TO service_role;

-- ── Бэкфилл: у каждого нынешнего аккаунта — своя запись ──────────────────────────────────
-- Имя здесь — запасное: API показывает имя аккаунта из профиля, а display_name нужен, пока
-- профиля нет. Дубль почты внутри воркспейса не роняет миграцию (ON CONFLICT DO NOTHING):
-- такой аккаунт получит запись при следующем изменении своей строки.
INSERT INTO public.people (group_id, display_name, email, account_id, source, created_by)
SELECT au.group_id,
       left(coalesce(
         nullif(btrim(concat_ws(' ', up.first_name, up.last_name)), ''),
         nullif(btrim(au.username), ''),
         nullif(lower(btrim(au.email)), ''),
         au.telegram_id::text,
         'участник'
       ), 120),
       CASE WHEN lower(btrim(au.email)) LIKE '%_@_%' THEN lower(btrim(au.email)) END,
       au.id, 'account', au.added_by
  FROM public.allowed_users au
  LEFT JOIN public.user_profiles up ON up.telegram_id = au.telegram_id
 WHERE au.group_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.people IS
  'Люди воркспейса: с аккаунтом (account_id) и без. Исполнители без входа и соисполнители задач (#874).';
COMMENT ON COLUMN public.tasks.assignee_person_id IS
  'Исполнитель без аккаунта. С аккаунтом — assignee_telegram_ids; триггер держит одно из двух.';
COMMENT ON COLUMN public.tasks.coassignee_telegram_ids IS
  'Производная: telegram_id соисполнителей с аккаунтом, для «Мои задачи». Пишет только триггер.';
