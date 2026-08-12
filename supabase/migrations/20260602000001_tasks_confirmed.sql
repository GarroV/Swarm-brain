-- supabase/migrations/20260602_tasks_confirmed.sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_telegram_id bigint;
