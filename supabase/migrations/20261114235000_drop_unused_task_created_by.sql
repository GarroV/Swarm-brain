-- Phase 2 of #238: phase-one writers/readers were removed before deployment.
-- Apply only via the canonical migration transaction (scripts/migrate-server.sh),
-- after owner approval in the deployment window. Do not commit the outer ledger early.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $isolation$
begin
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception using errcode = '25001',
      message = 'Task legacy-column removal requires a fresh read-committed snapshot';
  end if;
end;
$isolation$;

-- Acquire the strongest lock before reading data: a concurrent committed writer
-- must be visible to the guard, and no new writer may slip between guard and DROP.
lock table public.tasks in access exclusive mode;

do $drop_legacy$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.tasks'::regclass and attname = 'created_by'
      and attnum > 0 and not attisdropped
  ) then
    if exists (select 1 from public.tasks where created_by is distinct from 'system') then
      raise exception using errcode = '23514',
        message = 'Task legacy creator column is not constant; refusing removal';
    end if;
    alter table public.tasks drop column created_by restrict;
  end if;
end;
$drop_legacy$;
