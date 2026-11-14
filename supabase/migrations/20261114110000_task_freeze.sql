-- #814: pause a task independently of status, dates and recurrence.
alter table public.tasks add column if not exists frozen_at timestamptz;
alter table public.tasks add column if not exists frozen_by bigint;
comment on column public.tasks.frozen_at is 'Task freeze: visible, outside current workload/progress/overdue/review; null means active.';
comment on column public.tasks.frozen_by is 'Actor who froze the task; cleared on unfreeze.';

-- Old accepted snapshots remain exactly as counted before this feature. Only future acceptance
-- captures the task flag; sprint_items.frozen_at itself still means an immutable snapshot.
alter table public.sprint_items add column if not exists task_frozen boolean not null default false;
comment on column public.sprint_items.task_frozen is 'Task freeze captured at acceptance; legacy snapshots are false.';

do $patch$
declare
  fn regprocedure := 'public.accept_sprint_cycle(uuid,text,text,text,jsonb,text,date,date,date)'::regprocedure;
  definition text;
  old_fragment constant text := 'frozen_due_date     = t.due_date';
  new_fragment constant text := 'frozen_due_date     = t.due_date,
         task_frozen        = t.frozen_at is not null';
begin
  select pg_get_functiondef(fn) into definition;
  if strpos(definition, new_fragment) > 0 then return; end if;
  if (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment) <> 1 then
    raise exception 'task freeze: unexpected acceptance snapshot definition';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$patch$;

-- Only the existing review-write path uses this bounded RPC. Task -> item lock order matches
-- task archiving. NO KEY UPDATE also permits acceptance's FK key-share checks on carry inserts.
create or replace function public.update_sprint_item_check(
  p_cycle_id uuid, p_task_id uuid, p_group_id text, p_patch jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  task_frozen_at timestamptz;
  patch public.sprint_items;
  result_id uuid;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' or
     not (p_patch ? 'check_status' or p_patch ? 'check_note') or
     exists (select 1 from jsonb_object_keys(p_patch) k where k not in
       ('check_status','check_note','check_at','check_by','to_carry','carry_at','carry_by','carry_auto','carry_reason')) then
    raise exception 'Invalid review patch' using errcode = '22023';
  end if;
  select t.frozen_at into task_frozen_at from public.tasks t
    where t.id = p_task_id and t.group_id = p_group_id for no key update nowait;
  if not found then return null; end if;
  if task_frozen_at is not null then
    raise exception 'Task is frozen' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.sprint_cycles where id=p_cycle_id and group_id=p_group_id and status <> 'accepted') then
    return null;
  end if;
  perform 1 from public.sprint_items si
    where si.cycle_id=p_cycle_id and si.task_id=p_task_id
      and si.withdrawn_at is null and si.moved_at is null and si.frozen_at is null
    for update nowait;
  if not found then return null; end if;
  patch := jsonb_populate_record(null::public.sprint_items, p_patch);
  update public.sprint_items si set
    check_status = case when p_patch ? 'check_status' then patch.check_status else si.check_status end,
    check_note = case when p_patch ? 'check_note' then patch.check_note else si.check_note end,
    check_at = case when p_patch ? 'check_at' then patch.check_at else si.check_at end,
    check_by = case when p_patch ? 'check_by' then patch.check_by else si.check_by end,
    to_carry = case when p_patch ? 'to_carry' then patch.to_carry else si.to_carry end,
    carry_at = case when p_patch ? 'carry_at' then patch.carry_at else si.carry_at end,
    carry_by = case when p_patch ? 'carry_by' then patch.carry_by else si.carry_by end,
    carry_auto = case when p_patch ? 'carry_auto' then patch.carry_auto else si.carry_auto end,
    carry_reason = case when p_patch ? 'carry_reason' then patch.carry_reason else si.carry_reason end
    where si.cycle_id=p_cycle_id and si.task_id=p_task_id
      and si.withdrawn_at is null and si.moved_at is null and si.frozen_at is null
    returning si.id into result_id;
  return result_id;
exception when lock_not_available then
  raise exception 'Task changed; reload and try again' using errcode = 'PT409';
end;
$$;
revoke all on function public.update_sprint_item_check(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.update_sprint_item_check(uuid,uuid,text,jsonb) to service_role;

-- Freeze-state CAS for production acceptance. The original nine-argument function remains the
-- owner of snapshot/carry writes and remains usable by historical migration replay/tests.
-- Expected flags are transient, never stored in stats or a new table.
create or replace function public.accept_sprint_cycle_with_freeze(
  p_cycle_id uuid, p_group_id text, p_accepted_by text, p_summary text, p_stats jsonb,
  p_next_name text, p_next_start date, p_next_end date, p_next_check date,
  p_freeze_expected jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actual_flags jsonb;
  result jsonb;
  old_lock_timeout constant text := current_setting('lock_timeout');
begin
  if jsonb_typeof(p_freeze_expected) is distinct from 'object' or
     exists(select 1 from jsonb_each(p_freeze_expected) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'Invalid freeze expectation' using errcode = '22023';
  end if;
  if not exists(select 1 from public.sprint_cycles where id=p_cycle_id and group_id=p_group_id) then
    raise exception 'Sprint not found' using errcode = 'P0001';
  end if;

  -- Maintenance also has item/cycle -> task paths. Every known prelock is nonblocking:
  -- a conflicting operation produces a bounded rollback instead of a reverse-order wait.
  perform t.id from public.tasks t
    join jsonb_each(p_freeze_expected) e on e.key=t.id::text
    where t.group_id=p_group_id order by t.id for no key update of t nowait;
  perform 1 from public.sprint_cycles where id=p_cycle_id and group_id=p_group_id for update nowait;
  if not found then raise exception 'Sprint not found' using errcode = 'P0001'; end if;
  perform 1 from public.sprint_items where cycle_id=p_cycle_id order by id for update nowait;

  select coalesce(jsonb_object_agg(t.id::text, t.frozen_at is not null),'{}'::jsonb) into actual_flags
    from public.sprint_items si join public.tasks t on t.id=si.task_id
    where si.cycle_id=p_cycle_id and t.group_id=p_group_id
      and si.frozen_at is null and si.removed_at is null and si.moved_at is null;
  if actual_flags is distinct from p_freeze_expected then
    raise exception 'Task changed; reload and try again' using errcode = 'PT409';
  end if;

  -- Original carry can encounter rows outside the source composition. Bound those waits too,
  -- preserve a stricter caller timeout, and restore the exact prior setting on every outcome.
  if old_lock_timeout='0' or old_lock_timeout::interval > interval '250 milliseconds' then
    perform set_config('lock_timeout','250ms',true);
  end if;
  result := public.accept_sprint_cycle(p_cycle_id,p_group_id,p_accepted_by,p_summary,p_stats,
    p_next_name,p_next_start,p_next_end,p_next_check);
  perform set_config('lock_timeout',old_lock_timeout,true);
  return result;
exception when lock_not_available then
  perform set_config('lock_timeout',old_lock_timeout,true);
  raise exception 'Task changed; reload and try again' using errcode = 'PT409';
end;
$$;
revoke all on function public.accept_sprint_cycle_with_freeze(uuid,text,text,text,jsonb,text,date,date,date,jsonb)
  from public, anon, authenticated;
grant execute on function public.accept_sprint_cycle_with_freeze(uuid,text,text,text,jsonb,text,date,date,date,jsonb)
  to service_role;
