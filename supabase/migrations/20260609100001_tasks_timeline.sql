-- supabase/migrations/20260609100001_tasks_timeline.sql
-- Поля для таймлайна (Gantt-вид): start_date + порядок строки на таймлайне.
-- Инвариант start_date <= due_date проверяется в API (swarm-api), не триггером.
-- Additive — безопасно на prod.
alter table public.tasks
  add column if not exists start_date        date,
  add column if not exists timeline_position integer;

create index if not exists idx_tasks_dates on public.tasks (start_date, due_date) where start_date is not null;
