-- Feedback Inbox v2 — persistent inbox.
-- Только ADD COLUMN (безопасно): статус, категория, источник, durable-скрин, линк на задачу, время закрытия.
-- Валидация значений (enum статусов/категорий) — в коде (проект на SERVICE_ROLE, защита кодом), без хрупких CHECK.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS status         text        NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS category       text        NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS source         text        NOT NULL DEFAULT 'bot',
  ADD COLUMN IF NOT EXISTS screenshot_url text,
  ADD COLUMN IF NOT EXISTS task_id        uuid,
  ADD COLUMN IF NOT EXISTS resolved_at    timestamptz;
