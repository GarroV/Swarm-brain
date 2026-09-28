// «Новости» на главной (витрина; решение владельца 2026-09-25): вместо пяти счётчиков, которые
// повторяли соседние блоки, — то, что требует от человека действия: новые комментарии к его
// задачам (только если есть), горящие задачи, встречи на вычитке и напоминание отметиться на
// чекпоинте спринта. Встречи на вычитке берутся готовыми из данных дашборда; здесь — остальное.
// Чистая логика без React.

import type { SprintCycle, SprintCycleItem, Task } from "@/types";
import type { SwarmNotification } from "@/lib/api";
import { toISO } from "@/lib/calendar";
import { isDone } from "@/lib/smartLists";
import { dueDay } from "@/lib/taskCalendar";

/** Горит: срок прошёл, сегодня или завтра. Послезавтра — уже план, а не пожар. */
export const HOT_AHEAD_DAYS = 1;
export const HOT_LIMIT = 5;
export const COMMENTS_LIMIT = 3;
/** За сколько дней до сверки начинаем напоминать. */
export const CHECK_LEAD_DAYS = 2;

function dayShift(now: Date, n: number): string {
  return toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
}

/** Мои открытые задачи со сроком не позже завтра — самые ранние первыми. */
export function hotTasks(mine: Task[], now: Date): Task[] {
  const edge = dayShift(now, HOT_AHEAD_DAYS);
  return mine
    .filter((t) => !isDone(t))
    .map((t) => ({ t, d: dueDay(t) }))
    .filter((x): x is { t: Task; d: string } => x.d != null && x.d <= edge)
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(0, HOT_LIMIT)
    .map((x) => x.t);
}

/** Непрочитанные комментарии к моим задачам — из ленты уведомлений, свежие первыми. */
export function freshComments(items: SwarmNotification[]): SwarmNotification[] {
  return items
    .filter((n) => n.type === "task_comment" && !n.read_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, COMMENTS_LIMIT);
}

export type CycleWithItems = { cycle: SprintCycle; items: SprintCycleItem[] };
export type CheckpointReminder = { cycleId: string; name: string; checkDate: string; pending: number };

/**
 * Напоминание о сверке: спринт идёт, до чекпоинта ≤ CHECK_LEAD_DAYS или он уже прошёл (до финала),
 * а на моих открытых пунктах нет отметки «идёт / риск / проблема». «Мои» — по task_id среди моих
 * задач: у пунктов спринта исполнители только именами, сверять по имени ненадёжно.
 */
export function checkpointReminder(cycles: CycleWithItems[], myTaskIds: Set<string>, now: Date): CheckpointReminder | null {
  const today = toISO(now);
  const lead = dayShift(now, CHECK_LEAD_DAYS);
  for (const { cycle, items } of cycles) {
    if (cycle.status !== "active" || !cycle.check_date) continue;
    if (cycle.check_date > lead || today > cycle.end_date) continue;
    const pending = items.filter((i) =>
      i.task_id != null && myTaskIds.has(i.task_id) && !i.removed && !i.check_status && i.status !== "done"
    ).length;
    if (pending > 0) return { cycleId: cycle.id, name: cycle.name, checkDate: cycle.check_date, pending };
  }
  return null;
}
