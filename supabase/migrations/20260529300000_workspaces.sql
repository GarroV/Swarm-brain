-- Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add group_id to allowed_users
ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES workspaces(id);

-- Add group_id to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES workspaces(id);

-- entries.group_id was previously uuid (used for chunk grouping); convert to text and null out
-- old chunk-group UUIDs since workspace IDs are text ('cee', 'other', etc.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entries' AND column_name = 'group_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE entries ALTER COLUMN group_id TYPE text USING (NULL::text);
  END IF;
END $$;

-- Wire entries.group_id FK to workspaces (only if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'entries' AND constraint_name = 'entries_group_id_fkey'
  ) THEN
    ALTER TABLE entries ADD CONSTRAINT entries_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES workspaces(id);
  END IF;
END $$;
