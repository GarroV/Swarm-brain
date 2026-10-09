-- Присутствие: кто, где, что и когда делает в Swarm (#751). Внутренний механизм БЕЗ вывода на
-- экран: аватарок и «кто сейчас онлайн» в интерфейсе нет и не планируется.
--
-- Владелец 09.10.2026 (issue #751, последний комментарий): решили считать присутствие по
-- именам; с коллегами договорено, видно только админу.
--
-- Модель:
--   presence      — одна строка на человека: где он сейчас (раздел), в каком состоянии и с какого
--                   момента. Пишет веб пульсом раз в 30 с (miniapp/src/components/PresencePulse.tsx)
--                   через POST /presence → presence_ping.
--   presence_log  — только СМЕНЫ раздела/состояния и появления после паузы. Повторный пульс того
--                   же раздела в том же состоянии строки не даёт: иначе журнал рос бы на
--                   2 строки в минуту на человека и ничего бы не говорил. Хранится сутки.
--
-- Состояние: active — был ввод (клик, клавиша, прокрутка, движение) за последнюю минуту;
-- idle — вкладка открыта и видна, ввода нет; away — вкладка скрыта или закрыта.

CREATE TABLE IF NOT EXISTS public.presence (
  telegram_id  bigint PRIMARY KEY,
  group_id     text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  section      text NOT NULL CHECK (char_length(section) BETWEEN 1 AND 40),
  state        text NOT NULL CHECK (state IN ('active', 'idle', 'away')),
  -- Производная от state: одна правда, вторая колонка для удобства выборок.
  active       boolean GENERATED ALWAYS AS (state = 'active') STORED,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- С какого момента текущие раздел и состояние (меняется только на смене или появлении).
  since        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.presence_log (
  id          bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  group_id    text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  section     text NOT NULL CHECK (char_length(section) BETWEEN 1 AND 40),
  state       text NOT NULL CHECK (state IN ('active', 'idle', 'away')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presence_log_group_at_idx ON public.presence_log (group_id, at DESC);

-- Внешний замок, как у всех таблиц public (#41): политик нет, ходит только service_role.
-- Права выдаём явно: на свежем контуре Supabase CLI default ACL даёт service_role не всё
-- (см. 20261008220000_people.sql).
ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presence, public.presence_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.presence_log_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presence, public.presence_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.presence_log_id_seq TO service_role;

-- ── Пульс: обновить «где сейчас», в журнал — только смену ──────────────────────────────────
-- Пауза дольше 90 с (три пропущенных пульса) — человек уходил: его возвращение пишется в журнал
-- как новое появление, даже если раздел и состояние те же. Исчезновение (away после паузы) —
-- не появление: оно попадает в журнал только сменой состояния.
CREATE OR REPLACE FUNCTION public.presence_ping(
  p_tg bigint, p_group text, p_section text, p_state text
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_prev    public.presence%ROWTYPE;
  v_now     timestamptz := now();
  v_gap     boolean;
  v_changed boolean;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('active', 'idle', 'away') THEN
    RAISE EXCEPTION 'presence_ping: неизвестное состояние %', p_state;
  END IF;

  SELECT * INTO v_prev FROM public.presence WHERE telegram_id = p_tg FOR UPDATE;
  v_gap := NOT FOUND OR v_prev.last_seen_at < v_now - interval '90 seconds';
  v_changed := NOT FOUND
    OR v_prev.section IS DISTINCT FROM p_section
    OR v_prev.state IS DISTINCT FROM p_state
    OR v_prev.group_id IS DISTINCT FROM p_group;

  INSERT INTO public.presence AS p (telegram_id, group_id, section, state, last_seen_at, since)
  VALUES (p_tg, p_group, p_section, p_state, v_now, v_now)
  ON CONFLICT (telegram_id) DO UPDATE
     SET group_id = EXCLUDED.group_id,
         section = EXCLUDED.section,
         state = EXCLUDED.state,
         last_seen_at = EXCLUDED.last_seen_at,
         since = CASE WHEN v_changed OR v_gap THEN EXCLUDED.since ELSE p.since END;

  IF v_changed OR (v_gap AND p_state <> 'away') THEN
    INSERT INTO public.presence_log (telegram_id, group_id, section, state, at)
    VALUES (p_tg, p_group, p_section, p_state, v_now);
  END IF;
END $$;

-- ── Журнал хранится сутки ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presence_prune()
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  WITH gone AS (
    DELETE FROM public.presence_log WHERE at < now() - interval '24 hours' RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

-- Снаружи (anon через /rest/v1/rpc) — нельзя. Грант на PUBLIC наследуется в anon, поэтому
-- снимаем именно с PUBLIC; зовёт только приложение под service_role.
REVOKE ALL ON FUNCTION public.presence_ping(bigint, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.presence_prune() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.presence_ping(bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.presence_prune() TO service_role;

-- Чистка раз в час. Где pg_cron не включён (локальный и тестовый контуры) — не регистрируем:
-- там журнал живёт столько же, сколько сам контур. Повторная регистрация по имени обновляет.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('presence-log-prune', '17 * * * *', 'select public.presence_prune()');
  ELSE
    RAISE NOTICE 'pg_cron не включён — чистка presence_log не зарегистрирована';
  END IF;
END
$$;

COMMENT ON TABLE public.presence IS
  'Где сейчас человек в вебе: раздел, состояние, с какого момента (#751). Видно только админу, на экран не выводится.';
COMMENT ON TABLE public.presence_log IS
  'Смены раздела/состояния и появления после паузы > 90 с (#751). Хранится 24 ч (pg_cron presence-log-prune).';
COMMENT ON FUNCTION public.presence_ping(bigint, text, text, text) IS
  'Пульс веба: upsert presence; строка в presence_log только при смене раздела/состояния или появлении после паузы > 90 с.';
