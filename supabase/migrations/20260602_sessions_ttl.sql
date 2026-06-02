-- Add updated_at to sessions for TTL-based expiry (30 min)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
