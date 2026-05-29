-- Create the initial CEE workspace
INSERT INTO workspaces (id, name) VALUES ('cee', 'CEE')
  ON CONFLICT (id) DO NOTHING;

-- Add superadmin to allowed_users so getUserGroupId can resolve their workspace
-- (ADMIN_USER_ID = 744230399 is hardcoded in code but not in this table)
INSERT INTO allowed_users (telegram_id, group_id, added_by)
  VALUES (744230399, 'cee', 744230399)
  ON CONFLICT (telegram_id) DO UPDATE SET group_id = 'cee';

-- Assign all existing entries to CEE workspace
-- (includes rows where group_id was NULL-ed out during uuid→text conversion above)
UPDATE entries SET group_id = 'cee'
  WHERE group_id IS NULL OR group_id NOT IN (SELECT id FROM workspaces);

-- Assign all existing tasks to CEE workspace
UPDATE tasks SET group_id = 'cee' WHERE group_id IS NULL;

-- Assign all existing users to CEE workspace
UPDATE allowed_users SET group_id = 'cee' WHERE group_id IS NULL;
