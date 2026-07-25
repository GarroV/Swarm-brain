-- Напоминания о вычитке встреч (swarm-bot review_reminders_cron).
-- Когда владельцу в последний раз напоминали про эту невычитанную встречу
-- (entries.metadata.confirmed != true). NULL = ещё ни разу не напоминали.
-- Безопасно: ADD COLUMN nullable, без дефолта-переписи.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS last_review_reminded_at timestamptz;
