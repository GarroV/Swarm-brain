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
    where t.id = p_task_id and t.group_id = p_group_id for no key update;
  if not found then return null; end if;
  if task_frozen_at is not null then
    raise exception 'Task is frozen' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.sprint_cycles where id=p_cycle_id and group_id=p_group_id and status <> 'accepted') then
    return null;
  end if;
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
end;
$$;
revoke all on function public.update_sprint_item_check(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.update_sprint_item_check(uuid,uuid,text,jsonb) to service_role;
