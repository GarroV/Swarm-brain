// Календарный вид задач и «Что дальше» под коротким списком (витрина, экран «Задачи» по стенду,
// docs/redesign/stand/js/screens-tasks.js → calendarView / whatsNext). Чистая логика без React.

import type { Task } from "@/types";
import type { DateRange } from "@/lib/dateRange";
import { presetRange } from "@/lib/dateRange";
import { toISO } from "@/lib/calendar";
import { isDone } from "@/lib/smartLists";

// Длинный период рисуем прокруткой вбок, но не бесконечно: год колонками — это не обзор,
// а зависший экран. Обрез называем в подписи, молча не режем.
export const CAL_MAX_DAYS = 92;
// Короткий список оставляет пол-экрана пустым — тогда под ним показываем, что дальше.
export const NEXT_LIST_MAX = 6;
export const NEXT_SOON_LIMIT = 4;
export const NEXT_DONE_LIMIT = 3;

export type CalendarDays = { days: string[]; from: string; to: string; cut: boolean; defaulted: boolean };

/** Дни сетки: выбранный период или, если его нет, текущая неделя с понедельника. */
export function calendarDays(range: DateRange | null, now: Date = new Date()): CalendarDays {
  const r = range ?? presetRange("week", now);
  const days: string[] = [];
  const [y, m, d] = r.from.split("-").map(Number);
  for (let i = 0; days.length < CAL_MAX_DAYS; i++) {
    const iso = toISO(new Date(y, m - 1, d + i));
    if (iso > r.to) break;
    days.push(iso);
  }
  const last = days[days.length - 1] ?? r.from;
  return { days, from: r.from, to: r.to, cut: last < r.to, defaulted: range == null };
}

/** Локальный день срока «YYYY-MM-DD» — тот же пояс устройства, что у isOverdue. */
export function dueDay(task: Task): string | null {
  if (!task.due_date) return null;
  const dt = new Date(task.due_date);
  return isNaN(dt.getTime()) ? null : toISO(dt);
}

export type CalendarLayout = { byDay: Map<string, Task[]>; nodue: Task[]; outside: number };

// Карточки одного человека идут подряд: глаз ищет по кружку, а не по алфавиту задач.
const byPerson = (a: Task, b: Task) => (a.assignee_telegram_ids?.[0] ?? 0) - (b.assignee_telegram_ids?.[0] ?? 0);

/**
 * Раскладка задач по дням сетки. Задача со сроком вне показанных дней в сетку не попадает —
 * и это обязано быть сказано числом (`outside`): иначе полупустая неделя читается как «людям
 * нечего делать», а на деле работа стоит за краем окна.
 */
export function calendarLayout(tasks: Task[], days: string[]): CalendarLayout {
  const shown = new Set(days);
  const byDay = new Map<string, Task[]>(days.map((d) => [d, []]));
  const nodue: Task[] = [];
  let outside = 0;
  for (const t of tasks) {
    const d = dueDay(t);
    if (d == null) nodue.push(t);
    else if (shown.has(d)) byDay.set(d, [...byDay.get(d)!, t]);
    else outside++;
  }
  return {
    byDay: new Map([...byDay].map(([d, list]) => [d, [...list].sort(byPerson)])),
    nodue: [...nodue].sort(byPerson),
    outside,
  };
}

export type WhatsNext = { soon: Task[]; done: Task[] };

/**
 * «Дальше по сроку» и «Недавно закрытые» под коротким списком. pool — задачи в охвате
 * смотрящего (линза уже применена), shown — то, что уже есть на экране: его не повторяем.
 */
export function whatsNext(pool: Task[], shown: Task[]): WhatsNext {
  if (shown.length > NEXT_LIST_MAX) return { soon: [], done: [] };
  const seen = new Set(shown.map((t) => t.id));
  const soon = pool
    .filter((t) => !seen.has(t.id) && !isDone(t) && dueDay(t) != null)
    .sort((a, b) => dueDay(a)!.localeCompare(dueDay(b)!))
    .slice(0, NEXT_SOON_LIMIT);
  const done = pool
    .filter((t) => !seen.has(t.id) && isDone(t))
    .sort((a, b) => String(b.completed_at ?? "").localeCompare(String(a.completed_at ?? "")))
    .slice(0, NEXT_DONE_LIMIT);
  return { soon, done };
}

// До недели — колонки по дням во всю ширину; дольше — месячная сетка, неделя строкой
// (решение владельца 2026-09-25: не прокручивать колонки вбок, а провалиться в день).
export const WEEK_DAYS = 7;
// Сколько карточек влезает в ячейку сетки; остальное — «+N», клик проваливает в неделю дня.
export const CELL_MAX = 3;

export type CalendarMode = "week" | "month";
export const calendarMode = (days: string[]): CalendarMode => (days.length > WEEK_DAYS ? "month" : "week");

function shift(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(y, m - 1, d + n));
}

/** Неделя дня, с понедельника по воскресенье. */
export function weekOf(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number);
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const mon = shift(iso, -back);
  return Array.from({ length: WEEK_DAYS }, (_, i) => shift(mon, i));
}

export type GridCell = { iso: string; inRange: boolean };

/** Месячная сетка по дням периода: целые недели с понедельника, дни вне периода помечены. */
export function monthGrid(days: string[]): GridCell[][] {
  if (!days.length) return [];
  const shown = new Set(days);
  const last = days[days.length - 1];
  const weeks: GridCell[][] = [];
  for (let mon = weekOf(days[0])[0]; mon <= last; mon = shift(mon, WEEK_DAYS)) {
    weeks.push(weekOf(mon).map((iso) => ({ iso, inRange: shown.has(iso) })));
  }
  return weeks;
}
