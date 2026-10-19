-- Память об отправленных тревогах «встреча застряла в обработке» (#233, решение владельца 19.10.2026):
-- по одной строке на встречу, чтобы одна и та же встреча не слала тревогу дважды, а общее число тревог
-- в час можно было ограничить. Миграция только создаёт новую таблицу; пока код не пишет в неё, она пуста.
-- Логика — _shared/stalled-meeting-alerts.ts (зовёт почасовой крон swarm-bot).
--
-- Внешнего ключа на meetings нет намеренно: удаление встречи не должно ни падать, ни стирать след тревоги.
-- Обратимость: `drop table public.stalled_meeting_alerts;` после того, как код перестанет её читать.

create table if not exists public.stalled_meeting_alerts (
  meeting_id uuid primary key,
  alerted_at timestamptz not null default now()
);

comment on table public.stalled_meeting_alerts is
  'Встречи, по которым мастер-админу уже ушла тревога о застрявшей обработке (по одной на встречу). Пишет _shared/stalled-meeting-alerts.ts. #233.';

grant select, insert, update, delete on public.stalled_meeting_alerts to service_role;

alter table public.stalled_meeting_alerts enable row level security;
revoke all on public.stalled_meeting_alerts from public, anon, authenticated;
