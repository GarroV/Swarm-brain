-- «Пинг» задачи — ручное напоминание отдельно от срока (дедлайн 20 сентября, вспомнить 1-го).
-- Решения владельца 2026-08-26: пинг только ручной, одноразовый (сгорает после отправки),
-- получатель — исполнители, у общей задачи без исполнителя — тот, кто пинг поставил.
-- Безопасно: только ADD COLUMN nullable, без переписи таблицы и без изменения существующих.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS remind_date   date;      -- когда напомнить
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS reminded_at   timestamptz; -- когда напомнили (пинг сгорел)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS remind_set_by bigint;    -- кто поставил пинг

COMMENT ON COLUMN public.tasks.remind_date   IS 'День напоминания (пинга), независим от due_date. NULL = пинга нет.';
COMMENT ON COLUMN public.tasks.reminded_at   IS 'Момент отправки пинга. NOT NULL = пинг уже сгорел, повторно не шлём.';
COMMENT ON COLUMN public.tasks.remind_set_by IS 'Telegram id поставившего пинг — получатель, если у задачи нет исполнителя.';

-- Крон выбирает только неотправленные пинги: частичный индекс держит выборку маленькой
-- независимо от размера таблицы.
CREATE INDEX IF NOT EXISTS idx_tasks_pending_ping
  ON public.tasks (remind_date)
  WHERE remind_date IS NOT NULL AND reminded_at IS NULL;

-- Лента уведомлений (колокольчик) получает второй тип события. Старые строки остаются
-- валидными: 'task_comment' по-прежнему разрешён.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_comment', 'task_reminder'));
