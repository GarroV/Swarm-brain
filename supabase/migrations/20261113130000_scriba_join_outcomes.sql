-- Исходы заходов бота встреч scriba (issue #1244): записал / не впустили / выгнали / упал /
-- календарь не ответил / не пошёл и почему — на сервере, с человеком и встречей.
--
-- Зачем. Как закончился заход, видно было только в журнале контейнера-оркестратора; перезапуск
-- (`scripts/scriba-prod.sh up`) его стирал, и ответить «сколько встреч бот потерял за неделю и
-- почему» было нельзя. Журнал нотис (meeting_notices) этого не заменяет: он считает отправленные
-- людям сообщения под потолками и не знает ни «не впустили» (door_timeout), ни «календарь не
-- ответил» (calendar_unavailable), а сорванное потолком сообщение вообще не оставляет строки.
-- Пропуски meeting_calendar_misses — это то, что показывает рекордер, и причин «отклонил» /
-- «календарь не ответил» они не хранят.
--
-- Что и откуда пишется (новых каналов бот не получил — пишет сервер там, где исход уже приходит):
--   source='notice'   — meeting-notice: исход встречи из присланной нотисы; door_timeout — когда
--                       сервер на нотису «жду у двери» ответил боту «уходи».
--   source='calendar' — meeting-calendar: «не пойдёт» из ответа сервера боту на опросе календаря.
-- Записал успешно — это строка в meetings, здесь не дублируется; «не пришёл / не забрали» остаются в
-- meeting_calendar_misses (запрос, который сводит всё вместе, — docs/ARCHITECTURE.md, раздел scriba).
--
-- Повтор не множит строки: уникален (человек, ключ исхода, исход). Ключ — id встречи, ключ события
-- календаря или `person:<час UTC>` для причин уровня человека (календарь не ответил — раз в час, а
-- не раз в минуту опроса).
--
-- Обратимость: только добавляет таблицу; старый код о ней не знает. Откат —
-- `drop table public.scriba_join_outcomes;` после того, как код перестанет её писать.

create table if not exists public.scriba_join_outcomes (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  group_id     text not null references public.workspaces(id),
  invited_by   bigint not null references public.allowed_users(telegram_id) on delete cascade,
  -- Встреча может исчезнуть из meetings — исход остаётся в статистике.
  meeting_id   uuid references public.meetings(id) on delete set null,
  calendar_key text,
  outcome      text not null check (outcome in (
                 'door_denied', 'door_blocked', 'door_timeout', 'guest_access_closed',
                 'meeting_unavailable', 'account_signin_required', 'captcha',
                 'no_conference_link', 'no_owner', 'no_audio', 'recording_lost',
                 'container_died', 'join_failed',
                 'unsupported_platform', 'unrecognized_link', 'declined', 'not_accepted',
                 'manual_invite_exists', 'calendar_not_connected', 'calendar_token_dead',
                 'calendar_unavailable')),
  source       text not null check (source in ('notice', 'calendar')),
  outcome_key  text not null,
  detail       text,
  constraint scriba_join_outcomes_one unique (invited_by, outcome_key, outcome)
);

comment on table public.scriba_join_outcomes is
  'Исходы заходов бота scriba (#1244): не впустили / упал / календарь не ответил / не пойдёт и почему. Пишет сервер (meeting-notice, meeting-calendar).';
comment on column public.scriba_join_outcomes.outcome_key is
  'Ключ повтора: id встречи, ключ события календаря или person:<час UTC> у причин уровня человека.';

create index if not exists scriba_join_outcomes_time_idx
  on public.scriba_join_outcomes (occurred_at desc);

-- Data API: явный грант service_role (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.scriba_join_outcomes to service_role;
revoke all on public.scriba_join_outcomes from anon, authenticated;
alter table public.scriba_join_outcomes enable row level security;
