-- Спринты: пространство планирования по времени (issue #267).
--
-- Спринт — период с датами, который в конце ПРИНИМАЕТСЯ: состав замораживается клоном, итоги
-- считаются один раз, незакрытые задачи переносятся в следующий спринт. Живые задачи при этом
-- продолжают жить своей жизнью — архив спринта от их дальнейшей судьбы не зависит.
--
-- ⚠️ Таблица `sprints` (без `_cycles`) — это ВКЛАДКИ доски проектов, а не спринты. Историческое
-- имя, переименование отложено владельцем («не горит»). Спринты — здесь.
--
-- Почему состав отдельной таблицей, а не полем `tasks.sprint_cycle_id`: задача, прожившая три
-- спринта, при поле оставила бы след только в последнем, а владелец просил считать «сколько
-- спринтов заняла задача». Так же устроено у Plane (CycleIssue).

create table if not exists sprint_cycles (
  id          uuid primary key default gen_random_uuid(),
  group_id    text not null,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'draft' check (status in ('draft', 'active', 'accepted')),
  created_by  text,
  started_at  timestamptz,
  accepted_at timestamptz,
  accepted_by text,
  summary     text,
  stats       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sprint_cycles_dates check (start_date <= end_date)
);

comment on table sprint_cycles is 'Спринт: период планирования с приёмкой и снимком. Не путать с таблицей sprints — там вкладки доски проектов.';
comment on column sprint_cycles.stats is 'Итоги, посчитанные ОДИН РАЗ в момент приёмки. Не пересчитывать: отчёт не должен меняться от дальнейшей жизни задач.';

create index if not exists idx_sprint_cycles_group on sprint_cycles(group_id, start_date desc);

create table if not exists sprint_items (
  id        uuid primary key default gen_random_uuid(),
  cycle_id  uuid not null references sprint_cycles(id) on delete cascade,
  -- Задачу могут удалить — снимок обязан пережить это, поэтому SET NULL, а не CASCADE:
  -- строка остаётся с frozen_*, и отчёт принятого спринта не теряет позицию.
  task_id   uuid references tasks(id) on delete set null,
  in_plan   boolean not null default false,
  added_at  timestamptz not null default now(),
  added_by  text,
  -- Клон состояния на момент приёмки. До приёмки все frozen_* пустые.
  frozen_at           timestamptz,
  frozen_title        text,
  frozen_status       text,
  frozen_assignees    text[],
  frozen_project      text,
  frozen_completed_at timestamptz
);

comment on table sprint_items is 'Состав спринта и он же носитель клона: до приёмки — связь задача↔спринт, после — замороженная копия её состояния.';
comment on column sprint_items.in_plan is 'true — задача была в составе на момент старта («план»); false — взята уже по ходу («сверх плана»).';

create unique index if not exists uniq_sprint_items_cycle_task
  on sprint_items(cycle_id, task_id) where task_id is not null;
create index if not exists idx_sprint_items_cycle on sprint_items(cycle_id);
create index if not exists idx_sprint_items_task on sprint_items(task_id) where task_id is not null;

-- RLS как на всех таблицах public: включён, политик НЕТ (issue #41). Это внешний замок —
-- anon/authenticated получают deny-all, приложение ходит под service_role с rolbypassrls.
alter table sprint_cycles enable row level security;
alter table sprint_items  enable row level security;
