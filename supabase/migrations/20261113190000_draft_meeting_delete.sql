-- Backup rows are retained after their files expire. Preserve their immutable meeting_id
-- without requiring the deleted draft row to exist; no backup row/object/TTL is changed.
alter table public.meeting_audio_backups
  drop constraint meeting_audio_backups_meeting_id_fkey;

-- Member-move classification: deletion jobs/tombstones remain in the original home
-- group_id. requested_group_id is the original caller scope, not current membership.
-- No content follows the requester; a current home admin can finish a pending job.
-- Explicit draft deletion: commit the row removal and its recoverable cleanup together.
-- The job stores only authorization scope; primary object paths derive from meeting_id.
create table public.draft_meeting_deletions (
  meeting_id uuid primary key,
  group_id text not null,
  requested_by bigint not null,
  requested_group_id text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.draft_meeting_deletions enable row level security;
revoke all on public.draft_meeting_deletions from public, anon, authenticated, service_role;
grant select, insert, update on public.draft_meeting_deletions to service_role;

create function public.draft_meeting_delete_snapshot(p_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'version', m.xmin::text || ':' || m.ctid::text, 'group_id', m.group_id,
    'status', m.status, 'entry_id', m.entry_id,
    'recorders', m.recorders, 'co_owners', m.co_owners,
    'claim_owner', m.claim_owner, 'identity_verified', m.identity_verified,
    'attendees', m.attendees
  ) from public.meetings m where m.id = p_id;
$$;

create function public.start_draft_meeting_delete(
  p_id uuid, p_version text, p_group_id text, p_actor bigint, p_actor_group text
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  -- The caller has checked the existing guards against this exact snapshot.
  -- A concurrent edit, publication or scope change invalidates that decision.
  select m.id into v_id from public.meetings m
    where m.id = p_id and m.xmin::text || ':' || m.ctid::text = p_version
      and m.group_id = p_group_id and m.status <> 'in_base'
    for update;
  if not found then return false; end if;
  insert into public.draft_meeting_deletions(meeting_id, group_id, requested_by, requested_group_id)
    values (p_id, p_group_id, p_actor, p_actor_group);
  delete from public.meetings where id = v_id;
  return true;
end;
$$;
revoke all on function public.draft_meeting_delete_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.start_draft_meeting_delete(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.draft_meeting_delete_snapshot(uuid) to service_role;
grant execute on function public.start_draft_meeting_delete(uuid, text, text, bigint, text) to service_role;
