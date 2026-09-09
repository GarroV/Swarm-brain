-- Журнал изменений задачи (issue #286): было только «статус → статус», нужно «какое поле,
-- с чего на что, кем». ADD-only: ни одна колонка не удаляется и не переименовывается, старые
-- old_status/new_status остаются и дальше заполняются для field='status'.
--
-- Контекст: до 09.09.2026 историю писал только бот и только на перекате регулярной задачи —
-- на проде в таблице лежали ДВЕ строки на две задачи. Веб, где карточки тащат мышью, не писал
-- никогда. Поэтому запрос руководства «где, когда, куда передвинули» ответа не имел, и прошлое
-- восстановить нечем: данные копятся только вперёд, с момента этой раскатки.

alter table public.task_history
  add column if not exists field text,
  add column if not exists old_value text,
  add column if not exists new_value text,
  add column if not exists changed_by_telegram_id bigint,
  add column if not exists group_id text;

-- Существующие строки — это всегда смена статуса (других писателей не было).
-- WHERE обязателен: без него это UPDATE по всей таблице.
update public.task_history
   set field = 'status',
       old_value = coalesce(old_value, old_status),
       new_value = coalesce(new_value, new_status)
 where field is null;

-- Журнал читают двумя способами: история одной задачи и «все изменения за период».
create index if not exists idx_task_history_task_created
  on public.task_history (task_id, created_at desc);
create index if not exists idx_task_history_created
  on public.task_history (created_at desc);

comment on column public.task_history.field is
  'Что изменилось: status | due_date | assignee | project | sprint | priority (#286)';
comment on column public.task_history.changed_by_telegram_id is
  'Кто изменил — ключ человека; changed_by (text) остаётся legacy';
