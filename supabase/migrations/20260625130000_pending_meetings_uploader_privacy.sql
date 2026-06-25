-- ============================================================================
-- Backfill: scope EXISTING pending meetings to their uploader (privacy fix)
-- ============================================================================
-- Problem: pending (not-yet-confirmed) granola/read_ai meetings that were
-- imported before the pending=private contract was enforced are still
-- workspace-wide (is_private = false). They should be visible ONLY to the
-- uploader until that person confirms/publishes them.
--
-- New imports already follow the contract:
--   pending  = is_private:true  + owner_id = uploader's telegram_id
--   published (metadata.confirmed = 'true') = is_private:false (workspace-wide)
-- This migration brings legacy rows in line with that contract.
--
-- Scope of this backfill:
--   * Only entry_type = 'meeting' from source in ('granola','read_ai').
--   * Only PENDING rows: metadata->>'confirmed' is missing or not 'true'.
--     Published rows (confirmed = 'true') are intentionally LEFT
--     workspace-visible — publishing is the act of sharing.
--   * Only rows currently is_private = false (idempotent guard: already-private
--     rows are untouched, so this is SAFE TO RE-RUN).
--   * Only rows we can attribute: the uploader's telegram id must be present.
--     Rows with no uploader are LEFT AS-IS (can't attribute → can't scope).
--
-- COLUMN-NAME CAVEAT (verified against supabase/schema/00_base_schema.sql):
--   There is NO `added_by_telegram_id` COLUMN on public.entries. The entries
--   table has `added_by` (text) and `owner_id` (bigint). The uploader's
--   telegram id is stored inside the `metadata` jsonb as
--   `metadata->>'added_by_telegram_id'` (see swarm-bot/handlers/granola.ts).
--   So we read the uploader from metadata and cast it to bigint for owner_id.
--   NOTE: read_ai imports do NOT record an uploader (single OAuth token tied to
--   the CEE workspace), so their pending rows have no metadata uploader and are
--   left untouched by the metadata->>'added_by_telegram_id' IS NOT NULL guard.
--
-- HOW TO APPLY: run via apply_migration / the Supabase SQL editor — NOT via
--   `supabase db push`. The base schema was built by hand in the dashboard, so
--   migration history is drifted and `db push` is unreliable here.
-- ============================================================================

UPDATE public.entries
SET is_private = true,
    owner_id   = (metadata->>'added_by_telegram_id')::bigint
WHERE entry_type = 'meeting'
  AND source IN ('granola', 'read_ai')
  AND metadata->>'added_by_telegram_id' IS NOT NULL
  AND (metadata->>'confirmed' IS NULL OR metadata->>'confirmed' <> 'true')
  AND is_private = false;
