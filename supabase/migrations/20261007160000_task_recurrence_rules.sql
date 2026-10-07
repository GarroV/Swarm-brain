-- Произвольная повторяемость задач (#823), канон: docs/decisions/2026-10-07-custom-recurrence.md
--
-- Владелец: «нужно уметь настроить хоть каждый третий понедельник, хоть каждые 2 недели от
-- текущей даты». Словарь — RRULE (RFC 5545), но ОТДЕЛЬНЫМИ колонками, а не строкой: строку
-- RRULE не проверит CHECK в базе, а колонки проверяет.
--
--   recur_freq      FREQ      + yearly
--   recur_interval  INTERVAL  каждые N (1..99), по умолчанию 1 = как раньше
--   recur_weekdays  BYDAY     только weekly: дни ISO 1=пн..7=вс; NULL = день недели срока
--   recur_setpos    BYSETPOS  только monthly: n-й (1..5) или последний (-1) день недели срока;
--                             NULL = по числу месяца (recur_anchor_dom), как раньше
--
-- Только ADD COLUMN и пересоздание CHECK: существующие задачи не меняются (interval = 1,
-- остальное NULL — ровно прежнее поведение). Откат не требуется.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recur_interval smallint NOT NULL DEFAULT 1;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recur_weekdays smallint[];
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recur_setpos   smallint;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recur_freq_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recur_freq_chk
  CHECK (recur_freq IS NULL OR recur_freq IN ('daily', 'weekly', 'monthly', 'yearly'));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recur_interval_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recur_interval_chk
  CHECK (recur_interval BETWEEN 1 AND 99);

-- Значения 1..7 и непустой набор. Сортировку и уникальность держит код (validateRecurFields):
-- на уровне базы это лишний триггер ради косметики.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recur_weekdays_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recur_weekdays_chk
  CHECK (
    recur_weekdays IS NULL OR (
      cardinality(recur_weekdays) BETWEEN 1 AND 7
      AND recur_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
  );

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recur_setpos_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recur_setpos_chk
  CHECK (recur_setpos IS NULL OR recur_setpos BETWEEN 1 AND 5 OR recur_setpos = -1);

COMMENT ON COLUMN public.tasks.recur_freq IS
  'Цикличность: daily | weekly | monthly | yearly. NULL = обычная задача. День недели, число и месяц берутся из due_date; правило уточняют recur_interval / recur_weekdays / recur_setpos.';
COMMENT ON COLUMN public.tasks.recur_anchor_dom IS
  'Для monthly по числу и yearly: исходное число месяца (1–31), чтобы после зажатия по короткому месяцу вернуться к нему (31 янв → 28 фев → 31 мар; 29 фев → 28 фев → 29 фев).';
COMMENT ON COLUMN public.tasks.recur_interval IS
  'RRULE INTERVAL: каждые N дней/недель/месяцев/лет (1–99), отсчёт от срока задачи. 1 = каждый.';
COMMENT ON COLUMN public.tasks.recur_weekdays IS
  'RRULE BYDAY, только weekly: дни недели ISO 1=пн..7=вс. NULL = день недели срока. Недели с шагом recur_interval считаются от недели срока.';
COMMENT ON COLUMN public.tasks.recur_setpos IS
  'RRULE BYSETPOS, только monthly: n-й (1–5) или последний (-1) день недели срока в месяце («каждый 3-й понедельник»). Нет 5-го такого дня — месяц пропускается. NULL = по числу месяца.';
