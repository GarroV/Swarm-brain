-- Комната звонка встречи — ключ склейки в meeting-claim (решение владельца 26.10.2026: «склейка по
-- ссылке в первую очередь»). Раньше та же встреча под другим ключом искалась по времени и составу
-- и однажды склеила два РАЗНЫХ созвона. Формат — как у ключей комнат рекордера: `meet:<код>` /
-- `kontur:<комната>` (_shared/call-room.ts). Только добавление колонки и индекса.
alter table public.meetings add column if not exists call_room text;

comment on column public.meetings.call_room is
  'Комната звонка (meet:<код> / kontur:<комната>) — по ней claim склеивает записи одной встречи под разными ключами идентичности; null — ссылка неизвестна';

create index if not exists meetings_call_room_idx
  on public.meetings (group_id, call_room, started_at)
  where call_room is not null;
