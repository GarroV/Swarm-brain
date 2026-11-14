-- Phase 2 of #238: phase-one writers/readers were removed before deployment.
-- Apply only via the canonical migration transaction (scripts/migrate-server.sh),
-- after owner approval in the deployment window. Do not commit the outer ledger early.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $drop_legacy$
begin
  -- Supabase CLI replays individual statements without an outer transaction.
  -- Keep lock and DROP in the same atomic block; the production ledger still
  -- belongs to the canonical outer transaction. Apply lock bounds in either mode.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception using errcode = '25001',
      message = 'Task legacy-column removal requires a fresh read-committed snapshot';
  end if;
  set local lock_timeout = '5s';
  -- VOLATILE PL/pgSQL obtains a fresh snapshot for the subsequent data query
  -- after LOCK has waited; unsupported fixed-snapshot isolation was rejected above.
  lock table public.tasks in access exclusive mode;
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.tasks'::regclass and attname = 'created_by'
      and attnum > 0 and not attisdropped
  ) then
    if exists (select 1 from public.tasks where created_by is distinct from 'system') then
      raise exception using errcode = '23514',
        message = 'Task legacy creator column is not constant; refusing removal';
    end if;
    -- RESTRICT does not protect automatic dependencies (indexes, local CHECKs,
    -- extended statistics). Permit only this column's own literal system default.
    if exists (
      select 1 from pg_depend d
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
      where d.refclassid = 'pg_class'::regclass and d.refobjid = 'public.tasks'::regclass
        and a.attname = 'created_by' and a.attnum > 0 and not a.attisdropped
        and d.deptype in ('a', 'i', 'P', 'S')
        and not (
          d.classid = 'pg_attrdef'::regclass and exists (
            select 1 from pg_attrdef def
            where def.oid = d.objid and def.adrelid = a.attrelid and def.adnum = a.attnum
              and pg_get_expr(def.adbin, def.adrelid) = '''system''::text'
          )
        )
    ) then
      raise exception using errcode = '2BP01',
        message = 'Task legacy creator column has automatic dependencies; refusing removal';
    end if;
    alter table public.tasks drop column created_by restrict;
  end if;
end;
$drop_legacy$;
