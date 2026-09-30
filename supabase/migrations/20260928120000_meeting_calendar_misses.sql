-- Пропуски автозапуска бота по календарю (T102, решения D015/D022).
--
-- Человек включил автозапуск (allowed_users.scriba_autojoin), а бот на его встречу не пошёл или не
-- дошёл. Такой пропуск не должен пропадать в журнале службы: он записывается здесь с причиной, и его
-- читает рекордер человека (bumblebee, функция meeting-missed) — показать «бот не пришёл» и одним
-- действием позвать бота руками (приглашение D017, колонка invite_id).
--
-- Причины — _shared/calendar-missed.ts (MISS_REASONS): не Meet, ссылка не разобралась, календарь не
-- подключён, доступ к календарю протух, служба автозапуска не подхватила встречу (задания нет или его
-- никто не забрал), бот забрал задание и в звонке не появился. Один пропуск на человека, встречу и
-- причину (miss_key = ключ встречи; у причин человека — `autojoin:<дата по Белграду>`): повторные
-- опросы не множат строки.
--
-- Кто пишет: meeting-calendar (опрос оркестратора) и meeting-missed (опрос рекордера — по живому
-- календарю человека, поэтому пропуск виден и тогда, когда оркестратор лежит).
--
-- arrival_checked_at у meeting_calendar_jobs — итог проверки «дошёл ли бот» по забранному заданию:
-- проверка одна на задание. Пусто — вопрос открыт.
--
-- Обратимость: миграция только ДОБАВЛЯЕТ (таблица, колонка без умолчания, индексы). Старый код о них
-- не знает. Откат — `drop table public.meeting_calendar_misses; alter table public.meeting_calendar_jobs
-- drop column arrival_checked_at;` после того, как код перестанет их читать.

create table if not exists public.meeting_calendar_misses (
  id            uuid primary key default gen_random_uuid(),
  group_id      text not null references public.workspaces(id),
  invited_by    bigint not null references public.allowed_users(telegram_id) on delete cascade,
  miss_key      text not null,                          -- ключ встречи или autojoin:<YYYY-MM-DD>
  calendar_key  text,                                   -- <iCalUID|id>:<YYYY-MM-DD>; пусто у причин человека
  reason        text not null check (reason in (
                  'unsupported_platform', 'unrecognized_link', 'calendar_not_connected',
                  'calendar_token_dead', 'not_picked_up', 'not_arrived')),
  title         text,
  join_url      text,                                   -- есть, только если бота можно позвать руками
  platform      text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  detected_at   timestamptz not null default now(),
  invite_id     uuid references public.meeting_invites(id) on delete set null,  -- позвали руками по пропуску
  constraint meeting_calendar_misses_one unique (invited_by, miss_key, reason)
);

comment on table public.meeting_calendar_misses is
  'Пропуски автозапуска scriba по календарю (T102): бот не пошёл или не дошёл, с причиной. Читает рекордер человека (meeting-missed).';
comment on column public.meeting_calendar_misses.invite_id is
  'Ручное приглашение (meeting_invites), заведённое по этому пропуску из рекордера: пропуск закрыт.';

-- Рекордер читает свежие пропуски своего человека.
create index if not exists meeting_calendar_misses_person_idx
  on public.meeting_calendar_misses (invited_by, detected_at desc);

-- Data API: явный грант service_role (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.meeting_calendar_misses to service_role;
revoke all on public.meeting_calendar_misses from anon, authenticated;
alter table public.meeting_calendar_misses enable row level security;

alter table public.meeting_calendar_jobs add column if not exists arrival_checked_at timestamptz;

comment on column public.meeting_calendar_jobs.arrival_checked_at is
  'Когда закрыт вопрос «дошёл ли бот» по забранному заданию (T102). Пусто — не решено.';

create index if not exists meeting_calendar_jobs_arrival_open_idx
  on public.meeting_calendar_jobs (group_id, ends_at)
  where taken_at is not null and arrival_checked_at is null;
