CREATE TABLE IF NOT EXISTS public.feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   bigint NOT NULL,
  username      text,
  text          text NOT NULL,
  photo_file_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO service_role;
