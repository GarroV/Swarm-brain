-- ============================================================================
-- Durable-обработка длинных встреч: резюмируемая транскрибация по частям
-- ============================================================================
-- Проблема: meeting-ingest транскрибировал всё аудио в одном вызове Edge Function
-- (EdgeRuntime.waitUntil). Для длинной встречи (≈59 мин = один whisper-вызов на всё)
-- воркер убивается по wall-clock → summary_status навсегда 'processing' → watchdog
-- метит 'failed' → «обработка превысила лимит времени».
--
-- Решение: аудио-части сохраняются в Storage (бакет meeting-audio), обработка идёт
-- ПО КУСКУ за cron-тик (функция meeting-process, pg_cron каждую минуту), переживая
-- лимит воркера. Прогресс копится в process_state; last_progress_at — heartbeat для
-- watchdog (валим только при ЗАСТОЕ, не по общему возрасту); processing_lease —
-- защита от двойной обработки (ingest-проход и cron-тик не топчут друг друга).
--
-- Все изменения — ADD COLUMN (безопасно, обратносовместимо: старый код колонки
-- не читает; короткие встречи добиваются inline в ingest как раньше).
--
-- HOW TO APPLY: через apply_migration / SQL editor (db push ненадёжен — история
-- миграций дрифтит, базовая схема собрана руками в дашборде).
-- ============================================================================

-- Состояние резюмируемой обработки. Форма:
--   { "parts": [{ "track": "sys"|"mic", "name": "...", "offset": 0, "path": "meetingId/...", "done": false }],
--     "segments": [ { start, end, text, speaker } ],   -- накопленные сегменты готовых частей
--     "stage": "transcribe" | "summarize",
--     "attempts": 0 }                                   -- попыток на текущей застрявшей части
-- NULL для встреч granola/read_ai и старых записей — их путь не меняется.
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS process_state jsonb;

-- Heartbeat прогресса: обновляется при каждой успешно обработанной части. Watchdog
-- метит 'failed' только если прогресса нет дольше порога (а не по updated_at-возрасту),
-- чтобы здоровая длинная встреча, идущая по куску за тик, не убивалась.
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

-- Лиз обработки: воркер (ingest-проход или cron-тик) ставит его перед работой по встрече
-- и снимает после. Параллельный тик пропускает встречу со свежим лизом → нет двойной
-- транскрибации/двойных тезисов. Протухший лиз (воркер умер) перехватывается следующим тиком.
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS processing_lease timestamptz;

-- Частичный индекс под выборку cron'ом «незавершённые в обработке» — дёшево и быстро.
CREATE INDEX IF NOT EXISTS meetings_processing_idx
  ON public.meetings (last_progress_at)
  WHERE summary_status = 'processing';
