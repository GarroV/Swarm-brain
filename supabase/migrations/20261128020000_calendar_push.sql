-- Calendar push lifecycle and durable refresh queue. No Google credentials are public.
create table public.calendar_push_controls (
  telegram_id bigint primary key references public.allowed_users(telegram_id) on delete cascade,
  generation bigint not null default 1,
  processed_generation bigint not null default 0,
  refresh_after timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error text
);
create table public.calendar_watch_channels (
  id uuid primary key,
  telegram_id bigint not null,
  token text not null,
  resource_id text,
  expires_at timestamptz not null,
  state text not null check(state in ('starting','active','stopping')),
  -- Only retained on disconnect/replacement, solely to stop that old channel; deleted on success/expiry.
  stop_refresh_token text,
  created_at timestamptz not null default now()
);
create index calendar_watch_channels_person_idx on public.calendar_watch_channels(telegram_id);
create table public.calendar_push_snapshots (
  telegram_id bigint primary key references public.allowed_users(telegram_id) on delete cascade,
  group_id text not null references public.workspaces(id),
  plan jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.calendar_push_groups (
  group_id text primary key references public.workspaces(id),
  revision bigint not null default 0
);
create table public.calendar_push_skips (
  telegram_id bigint not null references public.allowed_users(telegram_id) on delete cascade,
  group_id text not null references public.workspaces(id),
  calendar_key text not null,
  reason text not null,
  payload jsonb not null,
  due_at timestamptz not null,
  expires_at timestamptz not null,
  reported_at timestamptz,
  primary key(telegram_id,calendar_key,reason)
);

alter table public.calendar_push_controls enable row level security;
alter table public.calendar_watch_channels enable row level security;
alter table public.calendar_push_snapshots enable row level security;
alter table public.calendar_push_groups enable row level security;
alter table public.calendar_push_skips enable row level security;
revoke all on public.calendar_push_controls,public.calendar_watch_channels,public.calendar_push_snapshots,public.calendar_push_groups from public,anon,authenticated;
grant select,insert,update,delete on public.calendar_push_controls,public.calendar_watch_channels,public.calendar_push_snapshots,public.calendar_push_groups to service_role;
revoke all on public.calendar_push_skips from public,anon,authenticated;
grant select,insert,update,delete on public.calendar_push_skips to service_role;

create function public.calendar_push_dirty(p_person bigint) returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.calendar_push_controls(telegram_id) select telegram_id from public.allowed_users where telegram_id=p_person
  on conflict(telegram_id) do update set generation=calendar_push_controls.generation+1,next_attempt_at=now();
$$;

-- Changes to integration/autojoin persist work in the same transaction as the user's setting.
-- Old credentials are kept only while the former Google channel needs stopping.
create function public.calendar_push_lifecycle() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare person bigint;
begin
  person := case when TG_OP='DELETE' then OLD.telegram_id else NEW.telegram_id end;
  if TG_TABLE_NAME='user_integrations' then
    if TG_OP='DELETE' then
      if OLD.service<>'google_calendar' then return OLD; end if;
    elsif NEW.service<>'google_calendar' then return NEW;
    end if;
    if TG_OP='DELETE' then
      update public.calendar_watch_channels set state='stopping',stop_refresh_token=coalesce(stop_refresh_token,OLD.api_key)
      where telegram_id=person;
    elsif TG_OP='UPDATE' and OLD.api_key is distinct from NEW.api_key then
      update public.calendar_watch_channels set state='stopping',stop_refresh_token=coalesce(stop_refresh_token,OLD.api_key)
      where telegram_id=person;
    end if;
  end if;
  perform public.calendar_push_dirty(person);
  if TG_TABLE_NAME='allowed_users' and TG_OP='UPDATE' then
    if not NEW.scriba_autojoin or OLD.group_id is distinct from NEW.group_id then
      delete from public.meeting_calendar_jobs where invited_by=person and taken_at is null;
      delete from public.calendar_push_snapshots where telegram_id=person;
      delete from public.calendar_push_skips where telegram_id=person and reported_at is null;
    end if;
  end if;
  if TG_OP='DELETE' then
    delete from public.meeting_calendar_jobs where invited_by=person and taken_at is null;
    delete from public.calendar_push_snapshots where telegram_id=person;
    delete from public.calendar_push_skips where telegram_id=person and reported_at is null;
    return OLD;
  end if;
  return NEW;
end;
$$;
create trigger calendar_push_autojoin after insert or update of scriba_autojoin,group_id on public.allowed_users for each row execute function public.calendar_push_lifecycle();
create trigger calendar_push_integration after insert or update of api_key or delete on public.user_integrations for each row execute function public.calendar_push_lifecycle();

create function public.calendar_push_take_controls(p_limit integer default 2)
returns setof public.calendar_push_controls language sql security definer set search_path=public,pg_temp as $$
  update public.calendar_push_controls set lease_until=now()+interval '3 minutes'
  where telegram_id in (
    select telegram_id from public.calendar_push_controls
    where (generation>processed_generation or refresh_after<=now()) and next_attempt_at<=now()
      and (lease_until is null or lease_until<now())
    order by next_attempt_at,telegram_id for update skip locked limit least(greatest(p_limit,1),5)
  ) returning *;
$$;

create function public.calendar_push_save_snapshot(p_person bigint,p_group text,p_plan jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.calendar_push_groups(group_id) values(p_group) on conflict do nothing;
  perform 1 from public.calendar_push_groups where group_id=p_group for update;
  if not exists(select 1 from public.allowed_users u where u.telegram_id=p_person and u.group_id=p_group) then
    raise exception 'calendar person changed workspace';
  end if;
  insert into public.calendar_push_snapshots(telegram_id,group_id,plan) values(p_person,p_group,p_plan)
    on conflict(telegram_id) do update set group_id=excluded.group_id,plan=excluded.plan,updated_at=now();
  update public.calendar_push_groups set revision=revision+1 where group_id=p_group;
  delete from public.calendar_push_skips where telegram_id=p_person and reported_at is null;
  insert into public.calendar_push_skips(telegram_id,group_id,calendar_key,reason,payload,due_at,expires_at)
    select p_person,p_group,s->>'calendar_key',s->>'reason',s,(s->>'starts_at')::timestamptz-interval '2 minutes',(s->>'ends_at')::timestamptz
    from jsonb_array_elements(p_plan->'skipped') s where s->>'calendar_key' is not null and s->>'starts_at' is not null
    on conflict(telegram_id,calendar_key,reason) do nothing;
end;
$$;

create function public.calendar_push_read_plans(p_group text) returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('revision',coalesce((select revision from public.calendar_push_groups where group_id=p_group),0),
    'plans',coalesce((select jsonb_agg(s.plan order by s.telegram_id) from public.calendar_push_snapshots s
      join public.allowed_users u on u.telegram_id=s.telegram_id and u.group_id=s.group_id and u.scriba_autojoin
      where s.group_id=p_group and exists(select 1 from public.user_integrations i where i.telegram_id=s.telegram_id and i.service='google_calendar')), '[]'::jsonb));
$$;

-- CAS + group row lock make concurrent refreshes reconcile from a current complete snapshot.
create function public.calendar_push_apply(p_group text,p_revision bigint,p_jobs jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_revision bigint;
begin
  insert into public.calendar_push_groups(group_id) values(p_group) on conflict do nothing;
  select revision into current_revision from public.calendar_push_groups where group_id=p_group for update;
  if current_revision<>p_revision then return false; end if;
  delete from public.meeting_calendar_jobs j where j.group_id=p_group and j.taken_at is null
    and not exists(select 1 from jsonb_array_elements(p_jobs) p where p->>'calendar_key'=j.calendar_key);
  insert into public.meeting_calendar_jobs(group_id,calendar_key,invited_by,join_url,platform,title,starts_at,ends_at,notice_recipients)
    select p_group,p->>'calendar_key',(p->>'invited_by')::bigint,p->>'join_url',p->>'platform',p->>'title',
      (p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
      coalesce(array(select jsonb_array_elements_text(p->'notice_recipients')::bigint),'{}'::bigint[])
    from jsonb_array_elements(p_jobs) p
    where exists(select 1 from public.allowed_users u where u.telegram_id=(p->>'invited_by')::bigint and u.group_id=p_group and u.scriba_autojoin)
    on conflict(group_id,calendar_key) do update set invited_by=excluded.invited_by,join_url=excluded.join_url,platform=excluded.platform,
      title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,notice_recipients=excluded.notice_recipients
    where meeting_calendar_jobs.taken_at is null and (meeting_calendar_jobs.invited_by,meeting_calendar_jobs.join_url,meeting_calendar_jobs.platform,
      meeting_calendar_jobs.title,meeting_calendar_jobs.starts_at,meeting_calendar_jobs.ends_at,meeting_calendar_jobs.notice_recipients)
      is distinct from (excluded.invited_by,excluded.join_url,excluded.platform,excluded.title,excluded.starts_at,excluded.ends_at,excluded.notice_recipients);
  return true;
end;
$$;

-- Backfill lifecycle work, never fetch Google from a database trigger.
insert into public.calendar_push_controls(telegram_id) select telegram_id from public.allowed_users where scriba_autojoin on conflict do nothing;

revoke all on function public.calendar_push_dirty(bigint),public.calendar_push_lifecycle(),public.calendar_push_take_controls(integer),
  public.calendar_push_save_snapshot(bigint,text,jsonb),public.calendar_push_read_plans(text),public.calendar_push_apply(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_push_dirty(bigint),public.calendar_push_take_controls(integer),public.calendar_push_save_snapshot(bigint,text,jsonb),
  public.calendar_push_read_plans(text),public.calendar_push_apply(text,bigint,jsonb) to service_role;
