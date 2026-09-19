-- Дата закрытия задачи (issue #267, спринты).
--
-- До сих пор её не было вовсе: и веб («закрыл сегодня» в списке задач), и любые отчёты брали
-- `updated_at` — а он сдвигается от ЛЮБОЙ правки. Переименовал закрытую в мае задачу — она
-- «закрыта сегодня». Спринтам нужна честная дата: когда закрыли и сколько шли к результату.
--
-- Проставляется в одной точке — `updateTask` в `_shared/tasks/db.ts` (через неё идут веб, бот и
-- MCP), решение о значении — чистая функция `completionPatch` в `_shared/tasks/statuses.ts`.

alter table tasks add column if not exists completed_at timestamptz;

comment on column tasks.completed_at is
  'Момент перехода в закрытый статус (done/cancelled); NULL у открытых. ВНИМАНИЕ: у задач, закрытых до 08.09.2026, значение получено бэкфиллом из updated_at и является ПРОКСИ, а не фактом — в отчётах за прошлые периоды точности не предполагать.';

create index if not exists idx_tasks_completed_at
  on tasks(completed_at) where completed_at is not null;

-- Бэкфилл прошлого: честной даты для уже закрытых задач взять негде, updated_at — ближайшее
-- приближение. Ограничено закрытыми задачами без значения, открытых не касается.
update tasks
   set completed_at = updated_at
 where status in ('done', 'cancelled')
   and completed_at is null;
