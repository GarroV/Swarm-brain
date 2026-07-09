-- Recorder heartbeat: мониторинг рекордера без ложного шума (замена Read.ai-watchdog).
-- Поля пишутся эндпоинтом meeting-heartbeat, читаются watchdog'ом checkRecorderHealth (swarm-bot).
-- ADD COLUMN — безопасно: не трогает существующие данные.
alter table allowed_users
  add column if not exists recorder_last_seen      timestamptz,   -- время последнего heartbeat
  add column if not exists recorder_last_recording boolean,       -- писал ли рекордер на момент heartbeat
  add column if not exists recorder_last_version   integer,       -- версия сборки (CFBundleVersion)
  add column if not exists recorder_expiry_warned  boolean not null default false; -- послан ли алерт об истечении токена
