-- Add allowed_markets to workspaces.
-- NULL means "use global list from _shared/countries.ts".
-- Non-null means this workspace restricts to these ISO codes only.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS allowed_markets text[] DEFAULT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO service_role;
