// Чистые утилиты для Gantt-таймлайна (Рой R-7). Без React — тестируемо отдельно.

export const DAY_WIDTH = 44; // px на один день
export const ROW_HEIGHT = 52;
export const BAR_HEIGHT = 32;

// Парсинг/форматирование дат в UTC, чтобы шаг в днях не плыл от таймзоны/DST.
export function parseISO(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function toISO(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export const DAY_MS = 86_400_000;

export function addDays(iso: string, n: number): string {
  return toISO(parseISO(iso) + n * DAY_MS);
}

export function diffDays(fromISO: string, toISODate: string): number {
  return Math.round((parseISO(toISODate) - parseISO(fromISO)) / DAY_MS);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Позиция даты на оси X относительно начала диапазона.
export function dateToX(iso: string, rangeStart: string, dayWidth = DAY_WIDTH): number {
  return diffDays(rangeStart, iso) * dayWidth;
}

// Дата под координатой X (со снапом к началу дня).
export function xToDate(x: number, rangeStart: string, dayWidth = DAY_WIDTH): string {
  return addDays(rangeStart, Math.round(x / dayWidth));
}

export type DayCell = {
  iso: string;
  dayOfMonth: number;
  weekday: number;        // 0=вс … 6=сб
  isWeekend: boolean;
  isToday: boolean;
  isMonthStart: boolean;
  monthLabel: string | null; // подпись месяца на первом дне месяца
};

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function buildDayScale(rangeStart: string, days: number): DayCell[] {
  const today = todayISO();
  const cells: DayCell[] = [];
  for (let i = 0; i < days; i++) {
    const iso = addDays(rangeStart, i);
    const dt = new Date(parseISO(iso));
    const weekday = dt.getUTCDay();
    const dayOfMonth = dt.getUTCDate();
    const isMonthStart = dayOfMonth === 1 || i === 0;
    cells.push({
      iso,
      dayOfMonth,
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
      isToday: iso === today,
      isMonthStart,
      monthLabel: isMonthStart ? `${MONTHS_RU[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` : null,
    });
  }
  return cells;
}

// Диапазон таймлайна: от самой ранней даты (или сегодня−7) до самой поздней (или сегодня+30),
// с запасом по краям. Возвращает старт и число дней.
export function computeRange(
  tasks: Array<{ start_date: string | null; due_date: string | null }>,
): { start: string; days: number } {
  const today = todayISO();
  let min = parseISO(today);
  let max = parseISO(today);
  for (const t of tasks) {
    for (const d of [t.start_date, t.due_date]) {
      if (!d) continue;
      const ts = parseISO(d);
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
  }
  const start = toISO(min - 7 * DAY_MS);
  const end = toISO(max + 30 * DAY_MS);
  return { start, days: diffDays(start, end) + 1 };
}

// Геометрия бара задачи. Задача только с due → точка-веха; с обеими → полоса.
export function barGeometry(
  task: { start_date: string | null; due_date: string | null },
  rangeStart: string,
  dayWidth = DAY_WIDTH,
): { x: number; width: number; isMilestone: boolean } | null {
  const { start_date, due_date } = task;
  if (!start_date && !due_date) return null;
  if (start_date && due_date) {
    const x = dateToX(start_date, rangeStart, dayWidth);
    const span = Math.max(1, diffDays(start_date, due_date) + 1);
    return { x, width: span * dayWidth, isMilestone: false };
  }
  const only = (due_date ?? start_date)!;
  return { x: dateToX(only, rangeStart, dayWidth), width: dayWidth, isMilestone: true };
}

// Editorial-палитра статусов (oklch). Насыщенные акценты вместо монохрома.
export function statusColor(status: string): { bar: string; text: string } {
  switch (status) {
    case "done":        return { bar: "oklch(0.72 0.16 155)", text: "oklch(0.27 0.05 155)" };
    case "in_progress": return { bar: "oklch(0.78 0.16 75)",  text: "oklch(0.30 0.06 75)" };
    case "cancelled":   return { bar: "oklch(0.70 0.02 0)",   text: "oklch(0.30 0 0)" };
    default:            return { bar: "oklch(0.62 0.19 264)", text: "oklch(0.98 0.01 264)" }; // open
  }
}
