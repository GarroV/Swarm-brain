-- One-off #121 maintenance helpers. Session-local only; this file never applies a repair.
-- A private measured plan is passed explicitly to pg_temp.repair_recorded_durations(jsonb).
CREATE TEMP TABLE IF NOT EXISTS duration_repair_session (unused boolean) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.recorded_duration_audio_hash(state jsonb)
RETURNS text LANGUAGE sql STABLE SET TimeZone TO 'UTC' AS $$
  SELECT CASE WHEN count(*) > 0 AND count(o.id) = count(*) THEN
    md5(jsonb_agg(jsonb_build_object('id', o.id, 'version', o.version,
      'metadata', o.metadata, 'updated_at', o.updated_at) ORDER BY p.ordinality)::text)
    ELSE NULL END
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'parts') = 'array'
    THEN state->'parts' ELSE '[]'::jsonb END) WITH ORDINALITY p(part, ordinality)
  LEFT JOIN storage.objects o ON o.bucket_id = 'meeting-audio' AND o.name = p.part->>'path';
$$;

CREATE OR REPLACE FUNCTION pg_temp.repair_recorded_durations(plan jsonb)
RETURNS integer LANGUAGE plpgsql SET TimeZone TO 'UTC' AS $$
DECLARE
  changed integer;
  seconds_attnum smallint;
BEGIN
  IF jsonb_typeof(plan) IS DISTINCT FROM 'array' OR jsonb_array_length(plan) <> 4 THEN
    RAISE EXCEPTION 'duration repair requires exactly four measured snapshots';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(plan) p(meeting_id uuid, row_hash text,
      audio_hash text, measured_seconds double precision)
    WHERE p.meeting_id IS NULL OR p.row_hash IS NULL OR p.audio_hash IS NULL
      OR p.measured_seconds IS NULL OR NOT (p.measured_seconds > 0 AND p.measured_seconds < 'Infinity'::float8))
    OR (SELECT count(DISTINCT x->>'meeting_id') FROM jsonb_array_elements(plan) x) <> 4 THEN
    RAISE EXCEPTION 'invalid duration repair plan';
  END IF;

  SELECT attnum INTO seconds_attnum FROM pg_attribute
    WHERE attrelid = 'public.meetings'::regclass AND attname = 'recorded_seconds';
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f' AND
    ((c.conrelid = 'public.meetings'::regclass AND seconds_attnum = ANY(c.conkey)) OR
     (c.confrelid = 'public.meetings'::regclass AND seconds_attnum = ANY(c.confkey)))) THEN
    RAISE EXCEPTION 'duration column participates in a foreign key; no repair applied';
  END IF;
  -- Fail closed on a user/extension trigger that could react to this column, without disabling it.
  -- Built-in FK checks do not change other fields or send messages.
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = f.pronamespace
    WHERE t.tgrelid = 'public.meetings'::regclass AND t.tgenabled <> 'D'
      AND (t.tgtype::integer & 16) <> 0
      AND (t.tgattr = ''::int2vector OR seconds_attnum = ANY(t.tgattr::smallint[]))
      AND NOT (t.tgisinternal AND n.nspname = 'pg_catalog' AND f.proname LIKE 'RI_FKey_%')) THEN
    RAISE EXCEPTION 'duration update has an unverified trigger; no repair applied';
  END IF;

  PERFORM 1 FROM public.meetings m JOIN jsonb_to_recordset(plan) p(meeting_id uuid)
    ON p.meeting_id = m.id ORDER BY m.id FOR UPDATE OF m;
  IF (SELECT count(*) FROM public.meetings m JOIN jsonb_to_recordset(plan) p(meeting_id uuid)
      ON p.meeting_id = m.id) <> 4 THEN
    RAISE EXCEPTION 'duration snapshot no longer matches; no repair applied';
  END IF;
  -- Keep object version/metadata stable between validation and commit as well as meeting rows.
  PERFORM 1 FROM public.meetings m JOIN jsonb_to_recordset(plan) p(meeting_id uuid) ON p.meeting_id = m.id
    CROSS JOIN LATERAL jsonb_array_elements(m.process_state->'parts') part
    JOIN storage.objects o ON o.bucket_id = 'meeting-audio' AND o.name = part->>'path'
    ORDER BY o.id FOR SHARE OF o;

  IF EXISTS (SELECT 1 FROM public.meetings m JOIN jsonb_to_recordset(plan)
      p(meeting_id uuid, row_hash text, audio_hash text, measured_seconds double precision) ON p.meeting_id = m.id
    WHERE m.recorded_seconds IS NOT NULL OR m.source <> 'desktop-agent' OR m.summary_status IS DISTINCT FROM 'done'
      OR m.agent_last_seen_at IS NOT NULL OR m.claim_owner IS NULL
      OR m.process_state->>'owner' IS DISTINCT FROM m.claim_owner::text
      OR coalesce(m.process_state->'challenge', 'null'::jsonb) <> 'null'::jsonb
      OR coalesce(m.process_state->'rival', 'null'::jsonb) <> 'null'::jsonb
      OR md5((to_jsonb(m) - 'recorded_seconds')::text) IS DISTINCT FROM p.row_hash
      OR pg_temp.recorded_duration_audio_hash(m.process_state) IS DISTINCT FROM p.audio_hash) THEN
    RAISE EXCEPTION 'duration snapshot no longer matches; no repair applied';
  END IF;

  UPDATE public.meetings m SET recorded_seconds = p.measured_seconds
    FROM jsonb_to_recordset(plan) p(meeting_id uuid, measured_seconds double precision) WHERE m.id = p.meeting_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 4 OR EXISTS (SELECT 1 FROM public.meetings m JOIN jsonb_to_recordset(plan)
      p(meeting_id uuid, row_hash text) ON p.meeting_id = m.id
    WHERE md5((to_jsonb(m) - 'recorded_seconds')::text) IS DISTINCT FROM p.row_hash) THEN
    RAISE EXCEPTION 'duration repair changed an unexpected field; rolling back';
  END IF;
  RETURN changed;
END;
$$;
