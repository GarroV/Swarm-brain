-- Create the initial CEE workspace
INSERT INTO workspaces (id, name) VALUES ('cee', 'CEE')
  ON CONFLICT (id) DO NOTHING;

-- Add superadmin to allowed_users so getUserGroupId can resolve their workspace
-- (ADMIN_USER_ID = 744230399 is hardcoded in code but not in this table)
INSERT INTO allowed_users (telegram_id, group_id)
  VALUES (744230399, 'cee')
  ON CONFLICT (telegram_id) DO UPDATE SET group_id = 'cee';

-- Assign all existing entries to CEE workspace
UPDATE entries SET group_id = 'cee' WHERE group_id IS NULL;

-- Assign all existing tasks to CEE workspace
UPDATE tasks SET group_id = 'cee' WHERE group_id IS NULL;

-- Assign all existing users to CEE workspace
UPDATE allowed_users SET group_id = 'cee' WHERE group_id IS NULL;
