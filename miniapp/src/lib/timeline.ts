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
// Защита от битого start_date (напр. год-опечатка/сорвавшийся drag → 2024 при due 2026):
// если старт более чем на столько дней раньше due — считаем его невалидным и игнорируем
// (задача становится вехой по due), чтобы один кривой старт не растягивал весь таймлайн на годы.
const MAX_TASK_SPAN_DAYS = 400;
export function taskDates(
  t: { start_date: string | null; due_date: string | null },
): { start: string | null; due: string | null } {
  let start = t.start_date;
  const due = t.due_date;
  if (start && due && diffDays(start, due) > MAX_TASK_SPAN_DAYS) start = null;
  return { start, due };
}

export function computeRange(
  tasks: Array<{ start_date: string | null; due_date: string | null }>,
): { start: string; days: number } {
  const today = todayISO();
  let min = parseISO(today);
  let max = parseISO(today);
  for (const t of tasks) {
    const { start, due } = taskDates(t);
    for (const d of [start, due]) {
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
  const { start: start_date, due: due_date } = taskDates(task);
  if (!start_date && !due_date) return null;
  if (start_date && due_date) {
    const x = dateToX(start_date, rangeStart, dayWidth);
    const span = Math.max(1, diffDays(start_date, due_date) + 1);
    return { x, width: span * dayWidth, isMilestone: false };
  }
  const only = (due_date ?? start_date)!;
  return { x: dateToX(only, rangeStart, dayWidth), width: dayWidth, isMilestone: true };
}

// Статусы — из семантических токенов (--status-*), а не сырой oklch: тюнятся под тёмную
// тему и совпадают с Таймлайном/StatusPill на той же поверхности задач.
export function statusColor(status: string): { bar: string; text: string } {
  switch (status) {
    case "done":        return { bar: "var(--status-done)", text: "var(--status-done)" };
    case "in_progress": return { bar: "var(--status-prog)", text: "var(--status-prog)" };
    case "cancelled":   return { bar: "var(--ink-soft)",    text: "var(--ink-soft)" };
    default:            return { bar: "var(--status-open)", text: "var(--status-open)" }; // open
  }
}
