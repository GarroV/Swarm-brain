-- Backfill entry_type and entry_date for existing entries based on source/metadata.
-- countries left NULL (new entries auto-detect via GPT going forward).

-- 1. entry_type from source
UPDATE entries
SET entry_type = CASE
  WHEN source = 'read_ai' THEN 'transcript'
  WHEN source = 'granola' THEN 'meeting'
  WHEN source = 'voice'   THEN 'note'
  ELSE 'note'
END
WHERE entry_type IS NULL;

-- 2. entry_date from metadata field (already stored there for read_ai and granola)
UPDATE entries
SET entry_date = (metadata->>'entry_date')::date
WHERE entry_date IS NULL
  AND metadata->>'entry_date' IS NOT NULL
  AND metadata->>'entry_date' ~ '^\d{4}-\d{2}-\d{2}$';
