-- Автозапуск бота по календарю (T100, решения D015/D016).
--
-- Оркестратор раз в минуту зовёт meeting-calendar под токеном агента. Сервер читает календари людей
-- воркспейса, включивших автозапуск, и на каждую встречу Meet в ближайшие минуты заводит ЗАДАНИЕ:
-- «какая встреча, за кого бот идёт, по какой ссылке». Задание одно на встречу воркспейса — у двоих
-- коллег одно событие, а бот нужен один; уникальность (group_id, calendar_key) держит это и между
-- опросами, и между двумя одновременными опросами. Оркестратор забирает задание один раз (taken_at).
--
-- Задание — не пропуск в ручную встречу: бот заявляет встречу как календарную, и meeting-claim
-- сверяет её с календарём названного человека сам (D016). Поэтому это отдельная таблица, а не строка
-- meeting_invites: та открывает ручную встречу и гасится в meeting-claim.
--
-- scriba_autojoin — согласие человека, чтобы бот сам приходил на его встречи. По умолчанию выключено
-- у всех: кому оно включается и как — решение владельца (см. docs/furca/blocks/orchestrator.md, T100).
--
-- Кто пишет: meeting-calendar (заводит и забирает). Отбор встреч — _shared/calendar-dispatch.ts.
--
-- Обратимость: миграция только ДОБАВЛЯЕТ (таблица, колонка с умолчанием). Старый код о них не знает.
-- Откат — `drop table public.meeting_calendar_jobs; alter table public.allowed_users drop column
-- scriba_autojoin;` после того, как код перестанет их читать.

alter table public.allowed_users add column if not exists scriba_autojoin boolean not null default false;

comment on column public.allowed_users.scriba_autojoin is
  'Бот scriba сам приходит на встречи Meet из подключённого Google-календаря человека (T100). Выключено по умолчанию.';

create table if not exists public.meeting_calendar_jobs (
  id            uuid primary key default gen_random_uuid(),
  group_id      text not null references public.workspaces(id),
  calendar_key  text not null,                          -- <iCalUID|id>:<YYYY-MM-DD>, _shared/calendar-key.ts
  invited_by    bigint not null references public.allowed_users(telegram_id) on delete cascade,
  join_url      text not null,                          -- ссылка из события, проверенная сервером
  platform      text not null check (platform in ('meet', 'kontur', 'zoom')),
  title         text,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  created_at    timestamptz not null default now(),
  taken_at      timestamptz,                            -- оркестратор забрал в работу
  taken_by      text references public.service_agents(id),
  constraint meeting_calendar_jobs_one_per_meeting unique (group_id, calendar_key),
  constraint meeting_calendar_jobs_ends_after_start check (ends_at > starts_at)
);

comment on table public.meeting_calendar_jobs is
  'Задания боту scriba на календарные встречи (T100): одно на встречу воркспейса, забирается оркестратором один раз.';
comment on column public.meeting_calendar_jobs.invited_by is
  'telegram_id человека, из чьего календаря встреча: бот действует за него (X-On-Behalf-Of), meeting-claim сверяет встречу с его календарём.';

-- Оркестратор забирает ожидающие задания своего воркспейса: частичный индекс по живым строкам.
create index if not exists meeting_calendar_jobs_pending_idx
  on public.meeting_calendar_jobs (group_id, starts_at)
  where taken_at is null;

-- Data API: явный грант service_role (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.meeting_calendar_jobs to service_role;
-- Умолчательные гранты Supabase дают anon/authenticated всё на новых таблицах public; снимаем
-- явно — второй замок поверх RLS.
revoke all on public.meeting_calendar_jobs from anon, authenticated;

-- RLS как внешний замок: включён, политик нет → anon/authenticated не получают ни одной строки.
alter table public.meeting_calendar_jobs enable row level security;
