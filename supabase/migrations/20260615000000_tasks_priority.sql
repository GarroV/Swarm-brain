-- Приоритет задачи (дизайн-хендофф design_handoff_roy: точки High/Med/Low).
-- Additive, nullable — существующие задачи остаются без приоритета. Безопасно на prod.

alter table public.tasks
  add column if not exists priority text;

alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
  check (priority is null or priority in ('high', 'med', 'low'));
