-- Template for new table migrations (required after 2026-10-30 Supabase breaking change).
-- Copy this file, rename to YYYYMMDDHHMMSS_your_table.sql, fill in table name and columns.
-- See: https://github.com/orgs/supabase/discussions/45329

CREATE TABLE public.your_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
  -- add columns here
);

-- Required: explicit grant for Data API access (PostgREST / supabase-js with service_role key).
-- Without this, all queries will return 42501 permission denied after the Oct 30 2026 rollout.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO service_role;
