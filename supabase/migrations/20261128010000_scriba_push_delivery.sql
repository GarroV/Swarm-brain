-- Durable signals. Job authorization/grants remain in meeting-invite/calendar and meeting-claim.
-- Workspace move: scriba_signal_outbox stays with its source workspace/job, never follows the
-- person. A removed pending calendar job deletes its signal through scriba_enqueue_signal;
-- manual invitation delivery remains bounded by its original workspace, grant and expiry.
alter table public.meeting_invites add column if not exists started_at timestamptz;
alter table public.meeting_calendar_jobs add column if not exists started_at timestamptz;
-- Existing taken rows belong to the previous orchestrator and must not be launched again.
update public.meeting_invites set started_at = taken_at where taken_at is not null;
update public.meeting_calendar_jobs set started_at = taken_at where taken_at is not null;

create table public.scriba_signal_outbox (
  kind text not null check (kind in ('invite', 'calendar')),
  work_id uuid not null,
  group_id text not null references public.workspaces(id),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  notified_at timestamptz,
  finished_at timestamptz,
  last_error text,
  primary key(kind, work_id)
);
alter table public.scriba_signal_outbox enable row level security;
revoke all on public.scriba_signal_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.scriba_signal_outbox to service_role;
create index scriba_signal_due on public.scriba_signal_outbox(available_at)
  where notified_at is null and finished_at is null;

create function public.scriba_enqueue_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text := case when TG_TABLE_NAME = 'meeting_invites' then 'invite' else 'calendar' end;
begin
  if TG_OP = 'DELETE' then
    delete from public.scriba_signal_outbox where kind = k and work_id = old.id;
    return old;
  end if;
  if new.taken_at is not null then return new; end if;
  if k = 'invite' then
    insert into public.scriba_signal_outbox(kind, work_id, group_id, available_at, expires_at)
      values(k, new.id, new.group_id, now(), new.expires_at)
      on conflict(kind, work_id) do nothing;
  else
    insert into public.scriba_signal_outbox(kind, work_id, group_id, available_at, expires_at)
      values(k, new.id, new.group_id, greatest(now(), new.starts_at - interval '2 minutes'), new.ends_at)
      on conflict(kind, work_id) do update set
        group_id = excluded.group_id, available_at = excluded.available_at, expires_at = excluded.expires_at,
        lease_id = null, lease_until = null, notified_at = null, finished_at = null, last_error = null;
  end if;
  return new;
end $$;
revoke all on function public.scriba_enqueue_signal() from public, anon, authenticated;
create trigger scriba_invite_signal after insert or delete on public.meeting_invites
  for each row execute function public.scriba_enqueue_signal();
create trigger scriba_calendar_signal after insert or update of starts_at, ends_at, join_url, invited_by or delete
  on public.meeting_calendar_jobs for each row execute function public.scriba_enqueue_signal();

insert into public.scriba_signal_outbox(kind, work_id, group_id, available_at, expires_at)
  select 'invite', id, group_id, now(), expires_at from public.meeting_invites
  where taken_at is null and used_at is null and expires_at > now();
insert into public.scriba_signal_outbox(kind, work_id, group_id, available_at, expires_at)
  select 'calendar', id, group_id, greatest(now(), starts_at - interval '2 minutes'), ends_at
  from public.meeting_calendar_jobs where taken_at is null and ends_at > now();

create function public.scriba_lease_signals(p_limit integer default 20, p_kind text default null, p_id uuid default null)
returns setof public.scriba_signal_outbox
language plpgsql security definer set search_path = '' as $$
begin
  update public.scriba_signal_outbox set finished_at = now(), last_error = 'expired_unconfirmed',
    lease_id = null, lease_until = null
    where notified_at is null and finished_at is null and expires_at <= now();
  return query
    with due as (
      select kind, work_id from public.scriba_signal_outbox
      where notified_at is null and finished_at is null and available_at <= now() and expires_at > now()
        and (lease_until is null or lease_until <= now())
        and (p_kind is null or kind = p_kind) and (p_id is null or work_id = p_id)
      order by available_at for update skip locked limit least(greatest(p_limit, 1), 20)
    )
    update public.scriba_signal_outbox o set lease_id = gen_random_uuid(), lease_until = now() + interval '90 seconds',
      attempts = o.attempts + 1
      from due where o.kind = due.kind and o.work_id = due.work_id returning o.*;
end $$;

create function public.scriba_finish_signal(p_kind text, p_id uuid, p_lease uuid, p_ok boolean, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.scriba_signal_outbox set
    notified_at = case when p_ok then now() else null end,
    finished_at = case when not p_ok and expires_at <= now() then now() else null end,
    last_error = case when p_ok then null when expires_at <= now() then 'expired_unconfirmed'
      else left(coalesce(p_error, 'unavailable'), 80) end,
    available_at = least(expires_at, now() + make_interval(secs => least(300, 5 * power(2, least(attempts - 1, 6)))::integer)),
    lease_id = null, lease_until = null
    where kind = p_kind and work_id = p_id and lease_id = p_lease and notified_at is null and finished_at is null;
  return found;
end $$;

-- A replay by the SAME agent resumes an unacknowledged start; Docker uses the immutable job id.
-- Another service agent can never take that row. Claim/used_at is also terminal after AutoRemove.
create function public.scriba_take_work(p_kind text, p_id uuid, p_group text, p_agent text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j jsonb;
begin
  if not exists(select 1 from public.service_agents where id = p_agent and group_id = p_group) then
    raise exception 'agent workspace mismatch';
  end if;
  if p_kind = 'invite' then
    select to_jsonb(i) into j from public.meeting_invites i where id = p_id and group_id = p_group for update;
    if j is null or (j->>'expires_at')::timestamptz <= now() then return jsonb_build_object('state','missing'); end if;
    if j->>'started_at' is not null or j->>'used_at' is not null then return jsonb_build_object('state','started'); end if;
    if j->>'taken_by' is not null and j->>'taken_by' <> p_agent then return jsonb_build_object('state','busy'); end if;
    update public.meeting_invites i set taken_at = coalesce(i.taken_at, now()), taken_by = p_agent
      where id = p_id returning to_jsonb(i) into j;
  elsif p_kind = 'calendar' then
    select to_jsonb(c) into j from public.meeting_calendar_jobs c where id = p_id and group_id = p_group for update;
    if j is null or (j->>'ends_at')::timestamptz <= now() then return jsonb_build_object('state','missing'); end if;
    if j->>'started_at' is not null or exists(select 1 from public.meeting_agent_grants
      where calendar_job_id = p_id and meeting_id is not null) then return jsonb_build_object('state','started'); end if;
    if (j->>'starts_at')::timestamptz < now() - interval '10 minutes' then return jsonb_build_object('state','missing'); end if;
    if not exists(select 1 from public.allowed_users u where u.telegram_id = (j->>'invited_by')::bigint
      and u.group_id = p_group and u.scriba_autojoin and exists(select 1 from public.user_integrations x
        where x.telegram_id = u.telegram_id and x.service = 'google_calendar')) then
      return jsonb_build_object('state','missing');
    end if;
    if (j->>'starts_at')::timestamptz > now() + interval '2 minutes' then return jsonb_build_object('state','not_due'); end if;
    if j->>'taken_by' is not null and j->>'taken_by' <> p_agent then return jsonb_build_object('state','busy'); end if;
    update public.meeting_calendar_jobs c set taken_at = coalesce(c.taken_at, now()), taken_by = p_agent
      where id = p_id returning to_jsonb(c) into j;
  else raise exception 'invalid work kind'; end if;
  return jsonb_build_object('state','taken','job',j);
end $$;

create function public.scriba_started_work(p_kind text, p_id uuid, p_group text, p_agent text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'invite' then
    update public.meeting_invites set started_at = coalesce(started_at, now())
      where id = p_id and group_id = p_group and taken_by = p_agent;
  elsif p_kind = 'calendar' then
    update public.meeting_calendar_jobs set started_at = coalesce(started_at, now())
      where id = p_id and group_id = p_group and taken_by = p_agent;
  else raise exception 'invalid work kind'; end if;
  return found;
end $$;

revoke all on function public.scriba_lease_signals(integer,text,uuid),
  public.scriba_finish_signal(text,uuid,uuid,boolean,text), public.scriba_take_work(text,uuid,text,text),
  public.scriba_started_work(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.scriba_lease_signals(integer,text,uuid),
  public.scriba_finish_signal(text,uuid,uuid,boolean,text), public.scriba_take_work(text,uuid,text,text),
  public.scriba_started_work(text,uuid,text,text) to service_role;

-- Secrets are supplied by the explicit deployment step, never embedded in cron commands.
-- Scheduling itself does not send anything until Vault and the due queues are configured.
create function public.scriba_push_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare api_url text; signal_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  select decrypted_secret into api_url from vault.decrypted_secrets where name = 'scriba_functions_url' limit 1;
  select decrypted_secret into signal_secret from vault.decrypted_secrets where name = 'scriba_signal_secret' limit 1;
  if api_url is null or signal_secret is null then return; end if;
  if exists(select 1 from public.scriba_signal_outbox where notified_at is null and finished_at is null
    and available_at <= now() and (lease_until is null or lease_until <= now())) then
    perform net.http_post(url := api_url || '/scriba-dispatch',
      headers := jsonb_build_object('Content-Type','application/json','X-Scriba-Signal-Secret',signal_secret),
      body := '{}'::jsonb, timeout_milliseconds := 45000);
  end if;
  -- calendar-push is an internal queue/renewal worker; it does not poll the bot or Cloudflare.
  if to_regclass('public.calendar_push_controls') is not null then
    if exists(select 1 from public.calendar_push_controls
      where (generation > processed_generation or refresh_after <= now()) and next_attempt_at <= now()
        and (lease_until is null or lease_until < now()))
      or exists(select 1 from public.calendar_watch_channels where state = 'stopping' or expires_at <= now())
      or exists(select 1 from public.calendar_push_skips where reported_at is null and due_at <= now() and expires_at > now())
      or exists(select 1 from public.meeting_calendar_jobs where arrival_checked_at is null
        and taken_at <= now() - interval '6 minutes' and ends_at > now()) then
      perform net.http_post(url := api_url || '/calendar-push?action=maintain',
        headers := jsonb_build_object('Content-Type','application/json','X-Scriba-Signal-Secret',signal_secret),
        body := '{}'::jsonb, timeout_milliseconds := 120000);
    end if;
  end if;
end $$;
revoke all on function public.scriba_push_tick() from public, anon, authenticated;
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('scriba-push-delivery', '* * * * *', 'select public.scriba_push_tick()');
  end if;
end $$;
