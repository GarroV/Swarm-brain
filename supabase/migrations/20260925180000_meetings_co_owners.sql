-- Совладельцы черновика встречи (решение владельца 2026-09-25, docs/decisions/2026-09-25-cards-in-panel.md
-- п. 26–27): участники встречи, у которых есть SWARM, видят и вычитывают черновик наравне с записавшим.
-- Считаются при claim (supabase/functions/_shared/meeting-owners.ts). Записавшие остаются в recorders.
-- Только ADD COLUMN: старый код колонку не видит, новый при пустом массиве ведёт себя как раньше.
alter table public.meetings
  add column if not exists co_owners bigint[] not null default '{}';

create index if not exists meetings_co_owners_gin on public.meetings using gin (co_owners);

comment on column public.meetings.co_owners is
  'Совладельцы черновика: участники встречи с аккаунтом SWARM (по e-mail приглашения, тот же воркспейс), кроме записавших. Видят и вычитывают; удалить может только записавший.';
