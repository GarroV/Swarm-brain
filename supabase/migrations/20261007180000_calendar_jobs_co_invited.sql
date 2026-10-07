-- Одна комната — один бот, доступ — всем причастным (07.10.2026).
--
-- У двух людей одна встреча может стоять разными событиями календаря на одну ссылку. Бот теперь
-- идёт в комнату один раз (_shared/calendar-dispatch.ts, dropSameRoom), а человек из второго
-- события записывается сюда — meeting-claim добавляет его в совладельцы записи: доступ к записи
-- не должен зависеть от того, чьё событие бот выбрал.
--
-- Откат — `alter table public.meeting_calendar_jobs drop column co_invited;` (сперва убрать из кода).
alter table public.meeting_calendar_jobs
  add column if not exists co_invited bigint[] not null default '{}';

comment on column public.meeting_calendar_jobs.co_invited is
  'Люди, у которых та же комната в то же время стоит другим событием: бот второй раз не идёт, они — совладельцы записи';
