-- Кто скрыл черновик встречи у себя (issue #818). Черновик групповой встречи — одна строка на всех,
-- кто её записал или в ней участвовал; удаление стирало его у всех. Теперь у групповой встречи
-- каждый скрывает её только у себя: id попадает сюда, и очередь вычитки этого человека её не
-- отдаёт (_shared/meeting-access.ts → draftMeetingsOwnScopedFilter). Остальным встреча видна.
alter table public.meetings
  add column if not exists hidden_for bigint[] not null default '{}';

comment on column public.meetings.hidden_for is
  'telegram_id тех, кто скрыл черновик у себя (групповая встреча). Пишет POST /agent-meetings/:id/hide.';
