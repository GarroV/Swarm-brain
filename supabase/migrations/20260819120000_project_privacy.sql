-- Приватность проекта верхнего уровня: явный тумблер «скрыть из общего пула» (владелец 2026-08-19).
-- Подпроект уже скрыт от чужих по умолчанию (parent_id≠null → виден только created_by+админу,
-- см. миграцию 20260807120000 + listProjects/canMutateProject) — это поле нужно именно для
-- top-level проекта, который иначе всегда общий на весь воркспейс. ADD COLUMN — безопасно, сразу.
alter table public.projects add column if not exists is_private boolean not null default false;
