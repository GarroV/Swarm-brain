-- supabase/migrations/20260519_tasks_columns.sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS country     text,
  ADD COLUMN IF NOT EXISTS assignee_telegram_id bigint;
