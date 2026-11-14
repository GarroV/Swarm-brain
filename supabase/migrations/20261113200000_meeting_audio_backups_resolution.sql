-- Разбор серверных копий записей (#1314). Копия лежала до срока и вычищалась независимо от того,
-- попала ли запись в какую-нибудь встречу, — потеря шла молча. Теперь копию разбирает система
-- (_shared/meeting-backup-resolve.ts, зовёт тик meeting-process), а уборка по сроку трогает только
-- разобранные.
--
-- Только добавление колонок и индекса (аддитивно). Обратимость:
--   alter table public.meeting_audio_backups drop column resolution, drop column resolution_note,
--     drop column resolved_at;  -- после того, как код перестанет их звать
--
--   resolution      — итог: covered (встреча получила полную запись того же человека),
--                     covered_elsewhere (тот же звук ушёл отдельной встречей), ingested (копия влита
--                     второй записью), needs_review (система не решила — нужен человек).
--   resolution_note — причина одной строкой (для журнала и ручного разбора).
--   resolved_at     — когда разобрана. Ставится только для первых трёх итогов: needs_review остаётся
--                     неразобранной и по сроку не вычищается, пока человек не закроет её сам
--                     (update … set resolved_at = now(), resolution = 'covered', resolution_note = '…').

alter table public.meeting_audio_backups
  add column if not exists resolution text
    check (resolution in ('covered', 'covered_elsewhere', 'ingested', 'needs_review')),
  add column if not exists resolution_note text,
  add column if not exists resolved_at timestamptz;

alter table public.meeting_audio_backups
  drop constraint if exists meeting_audio_backups_resolved_at_chk;
alter table public.meeting_audio_backups
  add constraint meeting_audio_backups_resolved_at_chk
  check (resolved_at is null or resolution in ('covered', 'covered_elsewhere', 'ingested'));

-- Разборщик выбирает ещё не разобранные; needs_review и разобранные из выборки уходят.
create index if not exists meeting_audio_backups_unresolved_idx
  on public.meeting_audio_backups (created_at)
  where resolution is null;

comment on column public.meeting_audio_backups.resolution is
  'Итог разбора копии (#1314): covered | covered_elsewhere | ingested | needs_review; null — ещё не разобрана.';
comment on column public.meeting_audio_backups.resolved_at is
  'Копия разобрана (covered/covered_elsewhere/ingested). Уборка по сроку (expires_at) трогает только такие.';
