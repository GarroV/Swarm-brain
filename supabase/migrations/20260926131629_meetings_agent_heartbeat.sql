-- Heartbeat служебного агента ПО ВСТРЕЧЕ (решение D018).
--
-- До этого удар бота scriba лежал в строке service_agents — одной на агента. Два контейнера на двух
-- встречах писали в неё по очереди, и живой своими ударами прятал замолчавший: сторож оборванной
-- записи молчал о настоящем обрыве, а сторож встреч-призраков видел ключ только одной встречи и
-- метил вторую 'failed' посреди записи. Теперь heartbeat бота несёт meeting_id и ложится в строку
-- САМОЙ встречи — у каждой встречи своя тишина.
--
-- Бот на встречу один, адресат алерта (claim_owner) уже в той же строке, поэтому хватает двух
-- колонок: отдельная таблица запусков понадобится, только если на одну встречу придут два агента.
--
-- Кто пишет: meeting-heartbeat (только агент, только в встречу своего воркспейса, где claim_owner —
-- человек из X-On-Behalf-Of; сверка — meeting-heartbeat/write.ts). Кто читает и сбрасывает флаг:
-- swarm-bot, сторожа recording-watchdog и ghost-sweep. Рекордер человека (bumblebee) сюда не пишет:
-- его heartbeat остаётся в allowed_users.recorder_last_*.
--
-- Обратимость: только ADD COLUMN, существующее не трогается, старый код колонок не видит. Откат —
-- `alter table public.meetings drop column agent_last_seen_at, drop column agent_last_recording;`
-- после того, как код перестанет их читать (порядок «сначала код, потом схема», CLAUDE.md).

alter table public.meetings
  add column if not exists agent_last_seen_at   timestamptz,
  add column if not exists agent_last_recording boolean;

comment on column public.meetings.agent_last_seen_at is
  'Последний heartbeat служебного агента (бота scriba) по ЭТОЙ встрече. NULL — агент встречу не писал. Сторожа: оборванная запись и встречи-призраки (D018).';
comment on column public.meetings.agent_last_recording is
  'Агент вёл запись на момент последнего удара. true и тишина дольше порога — контейнер умер посреди записи; сторож сбрасывает в false после алерта (дедуп, не удаление).';
