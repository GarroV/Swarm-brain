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

-- Wire the pre-existing group_id column in entries to the new workspaces table
-- (entries.group_id is TEXT and already exists; add the FK constraint only if not present)
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
