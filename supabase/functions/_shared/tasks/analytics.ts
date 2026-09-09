// Метрики по задачам — чистые расчёты, без сети (issue #286).
//
// Живёт в _shared, а не в MCP: те же числа понадобятся вебу (экран статистики и выгрузка CSV,
// этап Э3) и отчёту по спринту. Одно определение метрики на проект — иначе «закрыто за неделю»
// в трёх местах посчитается тремя разными способами, и доверия к цифрам не будет.
//
// Здесь только то, что считается БЕЗ журнала перемещений: журнал наполняется с даты раскатки
// #286, поэтому cycle time и time-to-start появятся позже (см. спеку task-analytics-design).

import { isClosedStatus } from "./statuses.ts";

export type StatsTask = {
  id: string;
  status: string;
  created_at?: string | null;
  completed_at?: string | null;
  due_date?: string | null;
  assignees?: string[] | null;
};

export type TaskStats = {
  /** Границы окна, за которое считали (ISO). */
  sinceISO: string;
  createdInPeriod: number;
  closedInPeriod: number;
  /** Lead time закрытых в периоде, в днях. null — ни у одной нет обеих дат. */
  leadTimeAvgDays: number | null;
  leadTimeMedianDays: number | null;
  /** Доля закрытых в срок среди тех, у кого срок был. null — таких задач нет. */
  onTimeRate: number | null;
  onTimeBase: number;
  openNow: number;
  inProgressNow: number;
  overdueNow: number;
  /** Кто сколько закрыл за период, по убыванию. */
  closedByAssignee: Array<{ name: string; count: number }>;
  /** Самая старая незакрытая задача, в днях. null — незакрытых нет. */
  oldestOpenDays: number | null;
};

const DAY_MS = 86_400_000;

function days(fromISO: string, toMs: number): number {
  return (toMs - Date.parse(fromISO)) / DAY_MS;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Сводка по выборке задач. `tasks` уже отфильтрованы по воркспейсу и видимости вызывающего —
 * доступ здесь НЕ проверяется (см. `_shared/tasks/access.ts`), функция только считает.
 */
export function computeTaskStats(
  tasks: StatsTask[],
  opts: { sinceISO: string; now?: Date },
): TaskStats {
  const nowMs = (opts.now ?? new Date()).getTime();
  const sinceMs = Date.parse(opts.sinceISO);
  const today = new Date(nowMs).toISOString().slice(0, 10);

  let createdInPeriod = 0, closedInPeriod = 0;
  let openNow = 0, inProgressNow = 0, overdueNow = 0;
  const leads: number[] = [];
  const closedBy = new Map<string, number>();
  let oldestOpen: number | null = null;

  for (const t of tasks) {
    const closed = isClosedStatus(t.status);
    if (t.created_at && Date.parse(t.created_at) >= sinceMs) createdInPeriod++;

    if (closed && t.completed_at && Date.parse(t.completed_at) >= sinceMs) {
      closedInPeriod++;
      if (t.created_at) leads.push(days(t.created_at, Date.parse(t.completed_at)));
      for (const name of t.assignees?.length ? t.assignees : ["—"]) {
        closedBy.set(name, (closedBy.get(name) ?? 0) + 1);
      }
    }

    if (!closed) {
      openNow++;
      if (t.status === "in_progress") inProgressNow++;
      // Просрочка считается по календарной дате: срок «сегодня» ещё не просрочен.
      if (t.due_date && t.due_date < today) overdueNow++;
      if (t.created_at) {
        const age = days(t.created_at, nowMs);
        if (oldestOpen === null || age > oldestOpen) oldestOpen = age;
      }
    }
  }

  // Дисциплина сроков — только по закрытым в периоде, у которых срок вообще стоял.
  const withDue = tasks.filter((t) =>
    isClosedStatus(t.status) && t.completed_at && Date.parse(t.completed_at) >= sinceMs && t.due_date
  );
  const onTime = withDue.filter((t) => t.completed_at!.slice(0, 10) <= t.due_date!).length;

  const avg = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null;
  const med = median(leads);

  return {
    sinceISO: opts.sinceISO,
    createdInPeriod,
    closedInPeriod,
    leadTimeAvgDays: avg === null ? null : round1(avg),
    leadTimeMedianDays: med === null ? null : round1(med),
    onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 100) / 100 : null,
    onTimeBase: withDue.length,
    openNow,
    inProgressNow,
    overdueNow,
    closedByAssignee: [...closedBy.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    oldestOpenDays: oldestOpen === null ? null : round1(oldestOpen),
  };
}

/** Начало окна для период-слова. Неизвестное слово — null, чтобы вызывающий отказал явно. */
export function periodStartISO(period: string, now: Date = new Date()): string | null {
  const map: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
  const d = map[period];
  if (!d) return null;
  return new Date(now.getTime() - d * DAY_MS).toISOString();
}
