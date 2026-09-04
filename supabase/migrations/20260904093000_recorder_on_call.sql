-- Присутствие рекордера: «человек в звонке» отдельно от «рекордер пишет» (issue #218,
-- решение владельца 04.09.2026 — docs/decisions/2026-09-04-on-air-v-panele-vstrech.md).
--
-- Панели «Встречи сегодня» нужно знать не только ЧТО идёт по календарю, но и где сидит сам
-- человек: у идущей встречи бессмысленно предлагать «Подключиться», если он уже там.
-- Источник — heartbeat рекордера (meeting-heartbeat), он же присылает ключ встречи.
alter table allowed_users
  add column if not exists recorder_last_on_call     boolean,  -- вход микрофона держало другое приложение
  add column if not exists recorder_last_meeting_key text;     -- «<uid>:<дата>» встречи, которую рекордер видел

comment on column allowed_users.recorder_last_on_call is
  'Шёл ли реальный созвон на момент heartbeat (CallDetector: вход микрофона держит не наш процесс).';
comment on column allowed_users.recorder_last_meeting_key is
  'identity_key встречи из meeting-current («<uid>:<дата>»). NULL — рекордер звонка не видит.';
