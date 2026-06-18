-- supabase/migrations/20260618120000_meetings_summary_status.sql
-- Статус ФОНОВОЙ обработки записи (транскрибация + тезисы) в meeting-ingest — отдельно от
-- meetings.status (который про публикацию: awaiting_review/in_base).
--
-- Зачем: с нарезкой длинных встреч на части фон делает несколько вызовов Whisper/GPT. Нужно
--   (1) идемпотентность — повторный upload (потерянный 202 → ретрай клиента) не запускает
--       вторую транскрибацию: 'processing'/'done' → отказ, null/'failed' → можно (пере)обработать;
--   (2) видимость сбоя — зависший 'processing' (воркер убит по wall-clock) и 'failed' заметны.
--
-- Additive — безопасно на prod (ADD COLUMN, null для существующих строк проходит CHECK).

alter table public.meetings
  add column if not exists summary_status text
  check (summary_status in ('processing', 'done', 'failed'));

create index if not exists idx_meetings_summary_status
  on public.meetings (summary_status) where summary_status is not null;
