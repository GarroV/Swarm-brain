-- #1021: role state and its durable journal change in one transaction.
create table public.master_admin_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('added', 'removed')),
  actor_telegram_id bigint not null,
  target_telegram_id bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
create index master_admin_events_recent on public.master_admin_events (created_at desc, id desc);
comment on table public.master_admin_events is
  'Append-only journal of master-admin membership changes. Only backend service_role can read or insert.';
alter table public.master_admin_events enable row level security;
revoke all on public.master_admin_events from public, anon, authenticated, service_role;
grant select, insert on public.master_admin_events to service_role;

create function public.change_master_admin_role(
  p_target bigint,
  p_actor bigint,
  p_action text,
  p_builtin bigint
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_count bigint;
  v_exists boolean;
begin
  if p_actor is null or p_actor = 0 or p_builtin is null
     or p_action is null or p_action not in ('added', 'removed') then
    raise exception 'invalid role change arguments' using errcode = '22023';
  end if;
  if p_target is null or (p_action = 'added' and p_target <= 0) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_id');
  end if;
  -- All role mutations share a lock; last-member checks and journal inserts cannot race.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('swarm.master-admin-role'));
  if p_action = 'added' then
    insert into public.master_admins (telegram_id, added_by) values (p_target, p_actor)
      on conflict (telegram_id) do nothing;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      return pg_catalog.jsonb_build_object('ok', true, 'changed', false);
    end if;
  else
    if p_target = p_builtin then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'builtin');
    end if;
    select count(*), coalesce(bool_or(telegram_id = p_target), false)
      into v_count, v_exists from public.master_admins;
    if not v_exists then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if v_count <= 1 then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'last');
    end if;
    delete from public.master_admins where telegram_id = p_target;
  end if;
  -- A journal failure aborts this statement, including the preceding membership write.
  insert into public.master_admin_events (action, actor_telegram_id, target_telegram_id)
    values (p_action, p_actor, p_target);
  return pg_catalog.jsonb_build_object('ok', true, 'changed', true);
end;
$$;
comment on function public.change_master_admin_role(bigint, bigint, text, bigint) is
  'Backend-only atomic membership change and journal. The caller authenticates the master admin and passes its identity.';
revoke all on function public.change_master_admin_role(bigint, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.change_master_admin_role(bigint, bigint, text, bigint) to service_role;
