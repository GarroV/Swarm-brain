-- task_comments: доводим до рабочего состояния (таблица была объявлена, но не использовалась).
-- Всё аддитивно и безопасно: таблица пустая.
alter table public.task_comments
  add column if not exists added_by_telegram_id bigint;

alter table public.task_comments
  alter column added_by drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_comments_task_id_fkey'
  ) then
    alter table public.task_comments
      add constraint task_comments_task_id_fkey
      foreign key (task_id) references public.tasks(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_task_comments_task_id on public.task_comments (task_id);
