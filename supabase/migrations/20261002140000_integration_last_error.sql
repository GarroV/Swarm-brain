-- Состояние интеграции (#175): Granola отвечала 403 SUBSCRIPTION_INACTIVE, а Swarm показывал
-- «новых заметок нет» — сбой был неотличим от пустоты, и last_polled_at исправно обновлялся.
-- Теперь опрос пишет причину сбоя сюда и стирает её при успехе; человеку один раз уходит
-- сообщение о сбое — днём, не ночью.
-- ADD COLUMN — безопасно, код без этих колонок продолжает работать.
alter table public.user_integrations
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_notified_at timestamptz;

comment on column public.user_integrations.last_error is
  'Причина последнего сбоя опроса (HTTP-статус и код сервиса); null — последний опрос прошёл. Пишет swarm-bot/handlers/granola.ts';
comment on column public.user_integrations.last_error_at is
  'Когда записан last_error; null вместе с ним';
comment on column public.user_integrations.last_error_notified_at is
  'Когда человеку сообщили о текущем сбое; сообщаем днём (08-21 по Белграду), ночной сбой — первым дневным опросом';
