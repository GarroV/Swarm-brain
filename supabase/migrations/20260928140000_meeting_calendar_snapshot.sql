-- Снимок календаря для пропусков автозапуска (T164, решение D023).
--
-- Рекордер человека часто спрашивает meeting-missed «бот не пришёл на мою встречу?». До T164 каждый
-- такой запрос шёл в Google Calendar — квота API общая на проект, а ответ меняется редко. Теперь
-- календарь людей с автозапуском снимает сервер по расписанию (функция meeting-calendar-snapshot:
-- 08:00, 11:00, 12:00 по Белграду — час решает _shared/calendar-snapshot.ts), а meeting-missed читает
-- только эти таблицы и задания.
--
-- meeting_calendar_snapshot_runs — одна строка на человека: последняя попытка снять календарь и её
-- итог; snapshot_at — когда календарь последний раз прочитан успешно (Google моргнул — утренний
-- снимок остаётся в силе, snapshot_at не двигается).
-- meeting_calendar_snapshot_events — встречи остатка дня из календаря: ожидаемая (бот должен прийти)
-- или громкая причина, видная по самому событию (не Meet, ссылка не разобралась). Строка снимка
-- действительна, только пока её snapshot_at равен snapshot_at человека: встреча, пропавшая из
-- календаря (отменили, перенесли), остаётся со старым временем и перестаёт читаться — без удаления.
--
-- Кто пишет: meeting-calendar-snapshot. Кто читает: meeting-missed.
--
-- Обратимость: миграция только ДОБАВЛЯЕТ (две таблицы, индексы). Старый код о них не знает. Откат —
-- `drop table public.meeting_calendar_snapshot_events; drop table public.meeting_calendar_snapshot_runs;`
-- после того, как код перестанет их читать.

create table if not exists public.meeting_calendar_snapshot_runs (
  invited_by    bigint primary key references public.allowed_users(telegram_id) on delete cascade,
  group_id      text not null references public.workspaces(id),
  snapshot_at   timestamptz,                            -- последний успешный снимок
  attempted_at  timestamptz not null,
  outcome       text not null check (outcome in (
                  'ok', 'calendar_not_connected', 'calendar_token_dead', 'calendar_unavailable'))
);

comment on table public.meeting_calendar_snapshot_runs is
  'Снимок календаря для пропусков scriba (T164, D023): последняя попытка по человеку и её итог. Пишет meeting-calendar-snapshot, читает meeting-missed.';
comment on column public.meeting_calendar_snapshot_runs.snapshot_at is
  'Когда календарь человека последний раз прочитан успешно. Действительны строки meeting_calendar_snapshot_events с тем же snapshot_at.';

create table if not exists public.meeting_calendar_snapshot_events (
  id            uuid primary key default gen_random_uuid(),
  group_id      text not null references public.workspaces(id),
  invited_by    bigint not null references public.allowed_users(telegram_id) on delete cascade,
  calendar_key  text not null,                          -- <iCalUID|id>:<YYYY-MM-DD>, _shared/calendar-key.ts
  snapshot_at   timestamptz not null,
  outcome       text not null check (outcome in ('expected', 'unsupported_platform', 'unrecognized_link')),
  title         text,
  join_url      text,                                   -- только у ожидаемой встречи
  platform      text check (platform in ('meet', 'kontur', 'zoom')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  constraint meeting_calendar_snapshot_events_one unique (invited_by, calendar_key),
  constraint meeting_calendar_snapshot_events_ends_after_start check (ends_at > starts_at)
);

comment on table public.meeting_calendar_snapshot_events is
  'Встречи дня из снимка календаря (T164, D023): ожидаемая или громкая причина. Действительна при snapshot_at = meeting_calendar_snapshot_runs.snapshot_at.';

-- meeting-missed читает идущие встречи своего человека из его последнего снимка.
create index if not exists meeting_calendar_snapshot_events_person_idx
  on public.meeting_calendar_snapshot_events (invited_by, snapshot_at, ends_at);

-- Data API: явный грант service_role (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.meeting_calendar_snapshot_runs to service_role;
grant select, insert, update, delete on public.meeting_calendar_snapshot_events to service_role;
-- Умолчательные гранты Supabase дают anon/authenticated всё на новых таблицах public; снимаем
-- явно — второй замок поверх RLS.
revoke all on public.meeting_calendar_snapshot_runs from anon, authenticated;
revoke all on public.meeting_calendar_snapshot_events from anon, authenticated;

-- RLS как внешний замок: включён, политик нет → anon/authenticated не получают ни одной строки.
alter table public.meeting_calendar_snapshot_runs enable row level security;
alter table public.meeting_calendar_snapshot_events enable row level security;
