-- Manual recordings are associated only after a person's explicit pair decision (#183).
-- Original rows/audio stay; full immutable snapshots outlive ordinary row deletion.
set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.meetings add column if not exists manual_merge_target_id uuid
  references public.meetings(id) on delete set null;
alter table public.meetings drop constraint if exists meetings_manual_merge_not_self;
alter table public.meetings add constraint meetings_manual_merge_not_self
  check (manual_merge_target_id is distinct from id);
create index if not exists meetings_manual_merge_target_idx on public.meetings(manual_merge_target_id)
  where manual_merge_target_id is not null;

create table if not exists public.manual_meeting_pair_decisions (
  id uuid primary key default gen_random_uuid(),
  source_meeting_id uuid not null,
  target_meeting_id uuid,
  target_entry_id uuid,
  target_key text not null,
  decision text not null check (decision in ('merge', 'separate')),
  actor_id bigint not null,
  home_group_id text not null,
  is_private boolean not null,
  source_snapshot jsonb not null,
  target_snapshot jsonb not null,
  entry_snapshot jsonb,
  source_notes jsonb not null default '[]'::jsonb,
  target_notes jsonb not null default '[]'::jsonb,
  arbitration text,
  canonical_meeting_id uuid,
  applied_transcript jsonb,
  recording_origin jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (target_meeting_id is not null or target_entry_id is not null),
  unique (source_meeting_id, target_key)
);
create unique index if not exists manual_meeting_one_active_merge on public.manual_meeting_pair_decisions(source_meeting_id)
  where decision = 'merge' and active;
create index if not exists manual_meeting_applied_version on public.manual_meeting_pair_decisions(canonical_meeting_id)
  where decision = 'merge' and applied_transcript is not null;
alter table public.manual_meeting_pair_decisions enable row level security;
revoke all on public.manual_meeting_pair_decisions from public, anon, authenticated;
grant select, insert, update on public.manual_meeting_pair_decisions to service_role;
comment on table public.manual_meeting_pair_decisions is
  'Immutable manual-pair decision/version history; home_group_id is historical home, not a user-move ownership column. No original-row foreign keys or deletion cascades.';

create or replace function public.manual_meeting_versions_immutable() returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') then
    raise exception using errcode = 'P0001', message = 'Manual meeting version history is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists manual_meeting_versions_immutable on public.manual_meeting_pair_decisions;
create trigger manual_meeting_versions_immutable before update on public.manual_meeting_pair_decisions
  for each row execute function public.manual_meeting_versions_immutable();

-- No deletion blocker, no deletion of another version. The nullable source link restores
-- surviving original rows; only the now-inactive association is retired, never its snapshots.
create or replace function public.manual_meeting_pair_deleted() returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  update public.manual_meeting_pair_decisions set active = false
    where active and (source_meeting_id = old.id or target_meeting_id = old.id);
  return old;
end;
$$;
drop trigger if exists manual_meeting_pair_deleted on public.meetings;
create trigger manual_meeting_pair_deleted after delete on public.meetings
  for each row execute function public.manual_meeting_pair_deleted();

-- Same numeric owner fields as canAccessDraftMeeting, without an admin bypass.
create or replace function public.manual_meeting_actor_owns(p_row jsonb, p_actor bigint)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare v text;
begin
  if p_actor is null or p_actor = 0 or p_row is null then return false; end if;
  for v in
    select value ->> 'telegram_id' from jsonb_array_elements(coalesce(nullif(p_row -> 'recorders', 'null'::jsonb), '[]'::jsonb))
    union all select value #>> '{}' from jsonb_array_elements(coalesce(nullif(p_row -> 'co_owners', 'null'::jsonb), '[]'::jsonb))
    union all select p_row ->> 'claim_owner'
  loop
    begin
      if v::numeric = p_actor then return true; end if;
    exception when invalid_text_representation or numeric_value_out_of_range then null;
    end;
  end loop;
  return false;
end;
$$;

-- Exact storage predicate of resolvePublishVisibility: unchanged one-person / one-on-one rules.
create or replace function public.manual_meeting_storage_allowed(p_row jsonb, p_actor bigint, p_private boolean)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare owners bigint[]; humans integer;
begin
  if not p_private then return true; end if;
  select array_agg(distinct raw::numeric::bigint) into owners from (
    select value ->> 'telegram_id' as raw
      from jsonb_array_elements(coalesce(nullif(p_row -> 'recorders', 'null'::jsonb), '[]'::jsonb))
    union all select value #>> '{}'
      from jsonb_array_elements(coalesce(nullif(p_row -> 'co_owners', 'null'::jsonb), '[]'::jsonb))
  ) ids where raw is not null and raw::numeric <> 0 and raw::numeric = trunc(raw::numeric);
  if coalesce(cardinality(owners), 0) <= 1 then return true; end if;
  select count(distinct lower(btrim(value ->> 'email'))) into humans
    from jsonb_array_elements(coalesce(nullif(p_row -> 'attendees', 'null'::jsonb), '[]'::jsonb))
    where coalesce((value ->> 'resource')::boolean, false) is not true
      and coalesce(btrim(value ->> 'email'), '') <> ''
      and lower(btrim(value ->> 'email')) !~ '@resource\.calendar\.google\.com$';
  return cardinality(owners) = 2 and p_actor = any(owners) and humans <= 2;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- A bounded, read-only service snapshot. Caller guards run before returning a UI DTO.
create or replace function public.manual_meeting_pair_snapshot(
  p_source uuid, p_target_meeting uuid default null, p_target_entry uuid default null,
  p_private boolean default false
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  s public.meetings%rowtype; t public.meetings%rowtype; e public.entries%rowtype;
  sx text; tx text; ex text; n integer := 0; member_hash text; member_count integer; queued boolean;
  prior public.manual_meeting_pair_decisions%rowtype;
begin
  if (p_target_meeting is null) = (p_target_entry is null) then
    raise exception using errcode = '22023', message = 'One target is required';
  end if;
  select m.* into s from public.meetings m where m.id = p_source;
  select m.xmin::text into sx from public.meetings m where m.id = p_source;
  if s.id is null then return null; end if;
  if p_target_meeting is not null then
    select m.* into t from public.meetings m where m.id = p_target_meeting;
  else
    select m.* into t from public.meetings m
      where m.entry_id = p_target_entry and m.id <> p_source and m.manual_merge_target_id is null
      order by m.created_at, m.id limit 1;
  end if;
  while t.manual_merge_target_id is not null loop
    n := n + 1;
    if n > 64 then raise exception using errcode = '54000', message = 'Manual meeting chain is too large'; end if;
    select m.* into t from public.meetings m where m.id = t.manual_merge_target_id;
  end loop;
  select m.xmin::text into tx from public.meetings m where m.id = t.id;
  if p_target_meeting is not null and t.id is null then return null; end if;
  if p_target_entry is not null or t.entry_id is not null then
    select r.* into e from public.entries r where r.id = coalesce(p_target_entry, t.entry_id);
    select r.xmin::text into ex from public.entries r where r.id = e.id;
    if e.id is null then return null; end if;
  end if;
  with recursive members(id) as (
    select s.id union select t.id where t.id is not null
    union select m.id from public.meetings m join members parent on m.manual_merge_target_id = parent.id
  )
  select md5(string_agg(m.id::text || ':' || m.xmin::text, ',' order by m.id)), count(*)
    into member_hash, member_count from public.meetings m join members using(id);
  if member_count > 64 then raise exception using errcode = '54000', message = 'Manual meeting group is too large'; end if;
  with recursive members(id) as (
    select s.id union select t.id where t.id is not null
    union select m.id from public.meetings m join members parent on m.manual_merge_target_id = parent.id
  ) select exists (select 1 from members join storage.objects o
    on o.bucket_id = 'meeting-audio' and o.name like members.id::text || '/queued/%.json') into queued;
  select d.* into prior from public.manual_meeting_pair_decisions d
    where d.source_meeting_id = s.id and (
      (t.id is not null and d.target_meeting_id = t.id) or
      (e.id is not null and (d.target_entry_id = e.id or exists (
        select 1 from public.meetings old_target where old_target.id = d.target_meeting_id and old_target.entry_id = e.id
      )))
    ) order by d.created_at limit 1;
  return jsonb_build_object(
    'source', to_jsonb(s), 'target', case when t.id is null then null else to_jsonb(t) end,
    'entry', case when e.id is null then null else to_jsonb(e) end,
    'target_key', case when t.id is not null then 'm:' || t.id else 'e:' || e.id end,
    'versions', jsonb_build_object('source_id', s.id, 'target_id', t.id, 'entry_id', e.id,
      'source', sx, 'target', tx, 'entry', ex, 'members', member_hash, 'private', p_private, 'queued', queued),
    'previous', case when prior.id is null then null else jsonb_build_object(
      'id', prior.id, 'decision', prior.decision, 'active', prior.active,
      'source_meeting_id', prior.source_meeting_id, 'target_meeting_id', prior.target_meeting_id,
      'target_entry_id', prior.target_entry_id, 'arbitration', prior.arbitration
    ) end
  );
end;
$$;

-- The edge service validates the current existing guards/storage and computes the unchanged
-- arbitrateFullness on this exact snapshot. Only service_role can submit that prepared result.
create or replace function public.decide_manual_meeting_pair(
  p_actor bigint, p_group text, p_source uuid, p_target_meeting uuid, p_target_entry uuid,
  p_private boolean, p_expected jsonb, p_decision text,
  p_replace boolean default false, p_arbitration text default null, p_entry_patch jsonb default null
) returns jsonb language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  ctx jsonb; current_ctx jsonb; s jsonb; t jsonb; e jsonb; prior jsonb;
  sid uuid; tid uuid; eid uuid; r record; v_owner text; owner_id bigint; result_id uuid;
  source_notes jsonb; target_notes jsonb; origin jsonb; applied jsonb;
begin
  if p_decision not in ('merge', 'separate') or p_actor is null or p_actor = 0 then
    raise exception using errcode = '22023', message = 'Invalid manual meeting decision';
  end if;
  -- Do not rely on an earlier membership read remaining current until commit.
  perform 1 from public.allowed_users where telegram_id = p_actor and group_id = p_group for share nowait;
  if not found then raise exception using errcode = '42501', message = 'Meeting pair unavailable'; end if;
  ctx := public.manual_meeting_pair_snapshot(p_source, p_target_meeting, p_target_entry, p_private);
  if ctx is null then raise exception using errcode = '42501', message = 'Meeting pair unavailable'; end if;
  sid := (ctx #>> '{source,id}')::uuid; tid := (ctx #>> '{target,id}')::uuid; eid := (ctx #>> '{entry,id}')::uuid;
  -- Row order is deterministic, including existing associated descendants.
  for r in
    with recursive members(id) as (
      select sid union select tid where tid is not null
      union select m.id from public.meetings m join members parent on m.manual_merge_target_id = parent.id
    ) select m.id from public.meetings m join members using(id) order by m.id for update of m nowait
  loop null; end loop;
  if eid is not null then perform 1 from public.entries where id = eid for update nowait; end if;
  current_ctx := public.manual_meeting_pair_snapshot(p_source, p_target_meeting, p_target_entry, p_private);
  if current_ctx is null then raise exception using errcode = '42501', message = 'Meeting pair unavailable'; end if;
  s := current_ctx -> 'source'; t := nullif(current_ctx -> 'target', 'null'::jsonb); e := nullif(current_ctx -> 'entry', 'null'::jsonb);
  -- Only the existing published/frozen lifecycle can safely finalize the source without
  -- changing ingest/recorder policy. An entry link on an OPEN draft is not publication.
  if e is null or e ->> 'entry_type' is distinct from 'meeting' or e #> '{metadata,confirmed}' is distinct from 'true'::jsonb or
    (t is not null and t ->> 'status' is distinct from 'in_base') then
    raise exception using errcode = '42501', message = 'Meeting pair unavailable';
  end if;
  if s ->> 'identity_kind' is distinct from 'manual' or s ->> 'group_id' is distinct from p_group or
    not public.manual_meeting_actor_owns(s, p_actor) or sid = tid or
    not public.manual_meeting_storage_allowed(s, p_actor, p_private) then
    raise exception using errcode = '42501', message = 'Meeting pair unavailable';
  end if;
  if t is not null and (t ->> 'group_id' is distinct from p_group or not public.manual_meeting_actor_owns(t, p_actor) or
    not public.manual_meeting_storage_allowed(t, p_actor, p_private)) then
    raise exception using errcode = '42501', message = 'Meeting pair unavailable';
  end if;
  if e is not null and (e ->> 'group_id' is distinct from p_group or e ->> 'archived_at' is not null or
    (e ->> 'owner_id')::bigint is distinct from p_actor or coalesce((e ->> 'is_private')::boolean, false) <> p_private) then
    raise exception using errcode = '42501', message = 'Meeting pair unavailable';
  end if;
  -- Every original owner keeps their existing ability to read the resulting draft/entry.
  for v_owner in
    select value ->> 'telegram_id' from jsonb_array_elements(coalesce(nullif(s -> 'recorders', 'null'::jsonb), '[]'::jsonb))
    union all select value #>> '{}' from jsonb_array_elements(coalesce(nullif(s -> 'co_owners', 'null'::jsonb), '[]'::jsonb))
    union all select s ->> 'claim_owner'
  loop
    if v_owner is null then continue; end if;
    begin
      if v_owner::numeric = 0 or v_owner::numeric <> trunc(v_owner::numeric) then continue; end if;
      owner_id := v_owner::numeric::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then continue;
    end;
    if t is not null and not public.manual_meeting_actor_owns(t, owner_id) then
      raise exception using errcode = '42501', message = 'Meeting pair unavailable';
    end if;
    if e is not null and p_private and owner_id <> (e ->> 'owner_id')::bigint and
      not coalesce(nullif(e -> 'shared_with', 'null'::jsonb), '[]'::jsonb) @> to_jsonb(array[owner_id]) then
      raise exception using errcode = '42501', message = 'Meeting pair unavailable';
    end if;
  end loop;
  prior := nullif(current_ctx -> 'previous', 'null'::jsonb);
  if prior is not null then
    if prior ->> 'decision' = p_decision and (prior ->> 'active')::boolean then
      return prior || jsonb_build_object('repeated', true);
    end if;
    raise exception using errcode = '40001', message = 'Meeting pair decision changed';
  end if;
  if current_ctx -> 'versions' is distinct from p_expected then
    raise exception using errcode = '40001', message = 'Meeting pair changed';
  end if;
  if (current_ctx #>> '{versions,queued}')::boolean then
    raise exception using errcode = '55000', message = 'Meeting pair is busy';
  end if;
  if s ->> 'status' <> 'awaiting_review' or s ->> 'manual_merge_target_id' is not null or
    s ->> 'summary_status' = 'processing' or t ->> 'summary_status' = 'processing' or
    nullif(btrim(s ->> 'draft_notes_md'), '') is null or
    (t is not null and t ->> 'status' not in ('awaiting_review', 'in_base')) then
    raise exception using errcode = '55000', message = 'Meeting pair is busy';
  end if;
  if p_replace and (s ->> 'notes_edited_at' is not null or t ->> 'notes_edited_at' is not null) then
    raise exception using errcode = '40001', message = 'Edited meeting notes are protected';
  end if;
  with recursive versions(id) as (
    select sid union select m.id from public.meetings m join versions parent on m.manual_merge_target_id = parent.id
  ) select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) into source_notes
    from public.meeting_live_notes n join versions on n.meeting_id = versions.id;
  with recursive versions(id) as (
    select tid where tid is not null
    union select m.id from public.meetings m join versions parent on m.manual_merge_target_id = parent.id
  ) select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) into target_notes
    from public.meeting_live_notes n join versions on n.meeting_id = versions.id;
  if p_decision = 'merge' and p_replace then
    select d.recording_origin into origin from public.manual_meeting_pair_decisions d
      where d.canonical_meeting_id = sid and d.decision = 'merge' and d.applied_transcript = s -> 'transcript'
      order by d.created_at desc limit 1;
    origin := coalesce(origin, jsonb_build_object(
      'meeting_id', sid, 'started_at', s -> 'started_at', 'claim_owner', s -> 'claim_owner', 'recorders', s -> 'recorders'
    ));
    applied := (s -> 'transcript') || jsonb_build_object('manual_merge_origin', origin);
  end if;
  insert into public.manual_meeting_pair_decisions(
    source_meeting_id, target_meeting_id, target_entry_id, target_key, decision, actor_id,
    home_group_id, is_private, source_snapshot, target_snapshot, entry_snapshot,
    source_notes, target_notes, arbitration, canonical_meeting_id, applied_transcript, recording_origin
  ) values (
    sid, tid, eid, current_ctx ->> 'target_key', p_decision, p_actor, p_group, p_private,
    s, coalesce(t, e), e, source_notes, target_notes, p_arbitration, coalesce(tid, sid), applied, origin
  ) returning id into result_id;
  if p_decision = 'merge' then
    if p_replace and tid is not null then
      update public.meetings set transcript = applied, draft_notes_md = s ->> 'draft_notes_md', updated_at = now()
        where id = tid;
    end if;
    if p_replace and eid is not null then
      if p_entry_patch is null or not (p_entry_patch ? 'content' and p_entry_patch ? 'embedding') then
        raise exception using errcode = '22023', message = 'Prepared meeting content is required';
      end if;
      update public.entries set content = p_entry_patch ->> 'content', summary = p_entry_patch ->> 'summary',
        embedding = (p_entry_patch ->> 'embedding')::vector,
        metadata = p_entry_patch -> 'metadata', updated_at = now() where id = eid;
    end if;
    update public.meetings set manual_merge_target_id = tid,
      transcript = case when p_replace and tid is null then applied else transcript end,
      entry_id = coalesce(eid, entry_id), status = case when eid is null then status else 'in_base' end,
      updated_at = now() where id = sid;
  end if;
  return jsonb_build_object('id', result_id, 'decision', p_decision, 'source_meeting_id', sid,
    'target_meeting_id', tid, 'target_entry_id', eid, 'arbitration', p_arbitration, 'active', true, 'repeated', false);
end;
$$;

create or replace function public.manual_meeting_group_members(p_roots uuid[]) returns uuid[]
language plpgsql stable set search_path = public, pg_temp as $$
declare ids uuid[];
begin
  with recursive members(id) as (
    select m.id from public.meetings m where m.id = any(p_roots)
    union select m.id from public.meetings m join members parent on m.manual_merge_target_id = parent.id
  ) select array_agg(id order by id) into ids from members;
  if coalesce(cardinality(ids), 0) > 64 then
    raise exception using errcode = '54000', message = 'Manual meeting group is too large';
  end if;
  return coalesce(ids, '{}'::uuid[]);
end;
$$;

create or replace function public.manual_meeting_verified_origin(p_meeting uuid, p_transcript jsonb) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select d.recording_origin from public.manual_meeting_pair_decisions d
  where d.canonical_meeting_id = p_meeting and d.decision = 'merge' and d.applied_transcript = p_transcript
  order by d.created_at desc limit 1
$$;

revoke all on function public.manual_meeting_actor_owns(jsonb,bigint) from public,anon,authenticated;
revoke all on function public.manual_meeting_storage_allowed(jsonb,bigint,boolean) from public,anon,authenticated;
revoke all on function public.manual_meeting_versions_immutable() from public,anon,authenticated;
revoke all on function public.manual_meeting_pair_deleted() from public,anon,authenticated;
revoke all on function public.manual_meeting_pair_snapshot(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.decide_manual_meeting_pair(bigint,text,uuid,uuid,uuid,boolean,jsonb,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.manual_meeting_actor_owns(jsonb,bigint) to service_role;
grant execute on function public.manual_meeting_storage_allowed(jsonb,bigint,boolean) to service_role;
grant execute on function public.manual_meeting_pair_snapshot(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.decide_manual_meeting_pair(bigint,text,uuid,uuid,uuid,boolean,jsonb,text,boolean,text,jsonb) to service_role;
revoke all on function public.manual_meeting_group_members(uuid[]) from public,anon,authenticated;
grant execute on function public.manual_meeting_group_members(uuid[]) to service_role;
revoke all on function public.manual_meeting_verified_origin(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manual_meeting_verified_origin(uuid,jsonb) to service_role;

reset lock_timeout;
reset statement_timeout;
