// Короткие подписи спринтов для доски: «С5», «С4 → С6 · 🏁 01.12». Чистые функции — их читают
// мастер-план, меню, окна «Спринты задачи…» и «Ход задачи». Спринтов со временем десятки, поэтому
// на плитках и в строках — номер, а не имя целиком (владелец 22.10.2026: «что будет, когда
// спринты перевалятся за десятку? полоску явно передумать»).

type CycleLike = { id: string; name: string; start_date: string; end_date: string; status: string };

const NUMBERED = /^\s*(?:Спринт|Sprint)\s*(\d+)/i;
const SHORT_MAX = 6;

/** «Спринт 5 (осень)» → «С5»; без номера — имя, сокращённое до шести знаков. */
export function cycleShort(name: string): string {
  const m = NUMBERED.exec(name);
  if (m) return `С${m[1]}`;
  const t = name.trim();
  return t.length > SHORT_MAX ? `${t.slice(0, SHORT_MAX - 1)}…` : t;
}

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** «03.11–16.11» — даты спринта без года и без пробелов. */
export function cycleDates(c: Pick<CycleLike, "start_date" | "end_date">): string {
  return `${dm(c.start_date)}–${dm(c.end_date)}`;
}

/** Спринт, в окно которого попадает срок («спринт срока», 🏁). */
export function dueCycleOf<T extends Pick<CycleLike, "start_date" | "end_date">>(
  cycles: readonly T[],
  due: string | null,
): T | null {
  if (!due) return null;
  return cycles.find((c) => c.start_date <= due && due <= c.end_date) ?? null;
}

export type PlanLine =
  | { kind: "none" }
  | {
    kind: "span";
    from: string;
    /** `null` — один спринт. */
    to: string | null;
    /** Срок задачи и признак «план дольше срока» (последний спринт кончается позже срока). */
    due: { date: string; longer: boolean } | null;
  };

/**
 * Строка под задачей мастер-плана: отрезок незакрытых спринтов, где задача стоит, по началу
 * спринта. Принятые в строку не входят — это прошлое, оно в «Ходе задачи».
 */
export function planLine(
  task: { due_date: string | null; cycle_ids: readonly string[] },
  cycles: readonly CycleLike[],
): PlanLine {
  const live = cycles
    .filter((c) => c.status !== "accepted" && task.cycle_ids.includes(c.id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
  if (live.length === 0) return { kind: "none" };
  const first = live[0], last = live[live.length - 1];
  return {
    kind: "span",
    from: cycleShort(first.name),
    to: live.length > 1 ? cycleShort(last.name) : null,
    due: task.due_date ? { date: task.due_date, longer: last.end_date > task.due_date } : null,
  };
}
