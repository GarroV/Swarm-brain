-- user_profiles: роль, почта, псевдонимы
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS role         text CHECK (role IN ('marketing', 'bd', 'rnd')),
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS name_aliases text[] NOT NULL DEFAULT '{}';

-- tasks: роль задачи + массив исполнителей
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_role             text CHECK (task_role IN ('marketing', 'bd', 'rnd')),
  ADD COLUMN IF NOT EXISTS assignee_telegram_ids bigint[] NOT NULL DEFAULT '{}';

-- Перенести существующие данные в массив
UPDATE tasks
  SET assignee_telegram_ids = ARRAY[assignee_telegram_id]
  WHERE assignee_telegram_id IS NOT NULL;

-- Убрать старое поле
ALTER TABLE tasks DROP COLUMN IF EXISTS assignee_telegram_id;
