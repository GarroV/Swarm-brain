-- supabase/migrations/20260624120000_meetings_mic_start_offset.sql
-- Сдвиг старта микрофонной дорожки относительно системной (секунды, может быть < 0).
--
-- Зачем: дорожки «я» (микрофон) и «собеседник» (системный звук) стартуют не строго
-- одновременно — HAL process-tap и AVAudioRecorder инициализируются по-разному. Рекордер
-- замеряет (micFirstSample − systemFirstSample) монотонными часами и шлёт в meeting-claim как
-- mic_start_offset. meeting-ingest прибавляет его к таймстампам mic-дорожки при сведении,
-- чтобы реплики «я»/«собеседник» легли в правильную хронологию.
--
-- Additive — безопасно на prod (ADD COLUMN nullable, без дефолтных перезаписей).

alter table public.meetings
  add column if not exists mic_start_offset double precision;

comment on column public.meetings.mic_start_offset is
  'Сдвиг старта mic-дорожки относительно system (сек, может быть <0). Прибавляется к таймстампам mic при сведении транскрипта.';
