-- Пропуск бота на одну встречу (T165, решения D017/D021).
--
-- Токен служебного агента общий на воркспейс и сам по себе ни за кого не действует. Действовать за
-- человека бот может только по пропуску, который выдаёт сервер там, где у него есть основание:
-- оркестратор забрал приглашение человека (meeting_invites, D017) или задание автозапуска по его
-- календарю (meeting_calendar_jobs, D021). Пропуск называет агента, человека и встречу; заявка
-- (meeting-claim) привязывает его к строке встречи (meeting_id), и дальше heartbeat, выгрузка,
-- статус и уведомления по нему доступны только для этой встречи. Контейнер встречи получает пропуск,
-- а не токен агента.
--
-- Сам пропуск на руках у бота; в базе — только sha256-hex (как у всех токенов Swarm).
--
-- Кто пишет: meeting-invite и meeting-calendar (выдача при заборе), meeting-claim (привязка к
-- встрече). Кто читает: _shared/agent-auth.ts (вход бота во все двери за человека).
--
-- Обратимость: миграция только СОЗДАЁТ новый объект. Старый код о таблице не знает. Откат —
-- `drop table public.meeting_agent_grants;` после того, как код перестанет её читать.

create table if not exists public.meeting_agent_grants (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique,                   -- sha256-hex пропуска; сам пропуск не храним
  agent_id         text not null references public.service_agents(id) on delete cascade,
  group_id         text not null references public.workspaces(id),
  telegram_id      bigint not null references public.allowed_users(telegram_id) on delete cascade,
  invite_id        uuid references public.meeting_invites(id) on delete cascade,
  calendar_job_id  uuid references public.meeting_calendar_jobs(id) on delete cascade,
  join_url         text not null,                          -- ссылка из приглашения или события
  calendar_key     text,                                   -- ключ события у календарного пропуска
  title            text,                                   -- название события: его, а не присланное, видит человек
  meeting_id       uuid references public.meetings(id) on delete cascade,  -- строка встречи после заявки
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  constraint meeting_agent_grants_one_basis check ((invite_id is null) <> (calendar_job_id is null)),
  constraint meeting_agent_grants_calendar_key check (calendar_job_id is null or calendar_key is not null),
  constraint meeting_agent_grants_expiry_after_creation check (expires_at > created_at)
);

comment on table public.meeting_agent_grants is
  'Пропуски бота scriba на одну встречу (T165): выдаются при заборе приглашения или задания автозапуска, без пропуска бот ни за кого не действует.';
comment on column public.meeting_agent_grants.telegram_id is
  'За кого действует бот по этому пропуску: тот, кто позвал (приглашение), или владелец календаря (задание).';
comment on column public.meeting_agent_grants.meeting_id is
  'Встреча, к которой пропуск привязала первая заявка бота. Пусто — заявки ещё не было; другую встречу пропуск не открывает.';

-- Отдельного индекса по token_hash НЕ заводим: `unique` уже создаёт индекс.

-- Data API: явный грант service_role (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.meeting_agent_grants to service_role;
-- Умолчательные гранты Supabase дают anon/authenticated всё на новых таблицах public; снимаем
-- явно — второй замок поверх RLS.
revoke all on public.meeting_agent_grants from anon, authenticated;

-- RLS как внешний замок: включён, политик нет → anon/authenticated не получают ни одной строки.
alter table public.meeting_agent_grants enable row level security;
