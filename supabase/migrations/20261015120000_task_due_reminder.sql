-- Напоминание о сроке за день (решение владельца 15.10.2026, docs/decisions/2026-10-15-due-reminder.md).
-- Миграция идемпотентна целиком (её накатывает повторно порча, scripts/porcha-sql). Только добавление.

-- Какой срок уже отработан: напоминание ушло всем получателям за день до него. Срок перенесли —
-- значение не совпало с новым `due_date`, и за день до нового срока напомним снова.
alter table public.tasks add column if not exists due_reminded_for date;
-- Кому напоминание о текущем сроке уже дошло (telegram id): повторно им не шлём. Очищается
-- триггером при смене срока.
alter table public.tasks add column if not exists due_reminder_delivered_to bigint[] not null default '{}';

comment on column public.tasks.due_reminded_for is 'Срок (due_date), о котором уже напомнили за день. Не совпал с текущим due_date — напоминание ещё не отправлено.';
comment on column public.tasks.due_reminder_delivered_to is 'Кому напоминание о сроке уже дошло (telegram id); сбрасывается триггером trg_tasks_due_reminder_rearm при смене due_date.';

create or replace function public.tasks_due_reminder_rearm()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.due_date is distinct from old.due_date then
    new.due_reminder_delivered_to := '{}';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_due_reminder_rearm on public.tasks;
create trigger trg_tasks_due_reminder_rearm
  before update of due_date on public.tasks
  for each row execute function public.tasks_due_reminder_rearm();

revoke all on function public.tasks_due_reminder_rearm() from public;

-- Лента-колокольчик: новый тип «срок завтра» (раньше ручной пинг — task_reminder).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('task_comment', 'task_reminder', 'task_due_soon', 'maintenance'));
