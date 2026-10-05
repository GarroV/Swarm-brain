-- Чья запись легла в стенограмму встречи: бота встреч (scriba) или рекордера на Mac (bumblebee).
-- Бот ходит на встречу за человека, и по meetings.recorders (telegram_id человека) их записи
-- неотличимы (решение владельца 03.10.2026, #788). Ставит обработчик в той же UPDATE, что пишет
-- стенограмму (_shared/recorded-by.ts); null — запись не из рекордера/бота или ещё не расшифрована.
alter table public.meetings
  add column if not exists recorded_by text
  check (recorded_by in ('scriba', 'bumblebee'));

comment on column public.meetings.recorded_by is
  'Чья запись в стенограмме: scriba (бот встреч) | bumblebee (рекордер на Mac). Ставит meeting-processor.';

-- Уже расшифрованные встречи — по источнику последней выгрузки (process_state.source:
-- agent:… — бот, person:… — рекордер). Без источника — встречи до бота встреч: их писал рекордер.
update public.meetings
set recorded_by = case
  when process_state ->> 'source' like 'agent:%' then 'scriba'
  else 'bumblebee'
end
where source = 'desktop-agent'
  and transcript is not null
  and recorded_by is null
  and (
    process_state ->> 'source' like 'agent:%'
    or process_state ->> 'source' like 'person:%'
    or (process_state ->> 'source' is null and coalesce(agent_version, '') not like 'scriba-%')
  );

-- Названия встреч бота встреч. До 05.10.2026 бот заявлял календарную встречу без названия, и сервер
-- ставил заглушку «участник — ДД.ММ, ЧЧ:ММ» (#804). Настоящее название события бот получил вместе с
-- пропуском (meeting_agent_grants.title). Меняем только заглушку (хвост совпадает с началом встречи
-- по Белграду, как в _shared/meeting-title.ts) и только у неопубликованной встречи.
update public.meetings m
set title = g.title
from (
  select distinct on (meeting_id) meeting_id, btrim(title) as title
  from public.meeting_agent_grants
  where meeting_id is not null and nullif(btrim(title), '') is not null
  order by meeting_id, created_at desc
) g
where g.meeting_id = m.id
  and m.agent_version like 'scriba-%'
  and m.entry_id is null
  and m.started_at is not null
  and m.title like '% — ' || to_char(m.started_at at time zone 'Europe/Belgrade', 'DD.MM, HH24:MI');
