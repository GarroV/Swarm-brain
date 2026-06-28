-- «Рой Live»: пользовательские «пометки на полях», сделанные во время встречи.
-- Привязаны к meetings(id) + offset_sec (смещение от начала записи) — по нему пометка
-- потом ложится рядом с нужным тезисом (склейка по времени). Текст хранится ДОСЛОВНО
-- (ИИ его не переписывает; на фронте рисуется жирным как пользовательское).
CREATE TABLE IF NOT EXISTS public.meeting_live_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  group_id    text NOT NULL,
  author_id   bigint,                       -- telegram_id автора пометки (может быть null)
  offset_sec  integer NOT NULL DEFAULT 0,   -- секунды от started_at встречи
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_live_notes_meeting_idx
  ON public.meeting_live_notes (meeting_id, offset_sec);

-- Required: explicit grant for Data API access (PostgREST / supabase-js с service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_live_notes TO service_role;
