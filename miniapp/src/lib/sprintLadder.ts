// Подзадачи лесенкой в колонках доски (решение владельца 22.10.2026, п.15): подзадача стоит под
// родителем, если родитель в той же колонке, иначе — отдельной карточкой с подписью «↳ из …».
// Чистые функции: вёрстка их только рисует.
import { cycleShort } from "./sprintLabels";

export type LadderNode<T> = { item: T; kids: T[] };

/**
 * Лесенка колонки: корни — строки без родителя в этой же колонке, под каждым его подзадачи в
 * порядке колонки. Порядок корней — как в колонке.
 */
export function buildLadder<T extends { task_id: string | null }>(
  items: readonly T[],
  parentOf: (taskId: string) => string | null,
): LadderNode<T>[] {
  const here = new Set(items.flatMap((i) => (i.task_id ? [i.task_id] : [])));
  const parentHere = (i: T): string | null => {
    const p = i.task_id ? parentOf(i.task_id) : null;
    return p && here.has(p) && p !== i.task_id ? p : null;
  };
  return items.filter((i) => parentHere(i) === null).map((item) => ({
    item,
    kids: item.task_id
      ? items.filter((k) => parentHere(k) === item.task_id)
      : [],
  }));
}

type KidLike = { id: string; status: string; cycle_ids: readonly string[] };
type CycleLike = {
  id: string;
  name: string;
  start_date: string;
  status: string;
};

/**
 * «+ ещё N в С6» под лесенкой: незакрытые подзадачи родителя, которых нет в этой колонке и которые
 * стоят в других незакрытых спринтах. Группируются по ближайшему такому спринту.
 */
export function kidsElsewhere(
  kids: readonly KidLike[],
  thisCycleId: string,
  inColumn: ReadonlySet<string>,
  cycles: readonly CycleLike[],
): { short: string; n: number }[] {
  const open = cycles.filter((c) =>
    c.status !== "accepted" && c.id !== thisCycleId
  )
    .sort((a, b) =>
      a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id)
    );
  const counts = new Map<string, number>();
  for (const k of kids) {
    if (inColumn.has(k.id) || k.status === "done" || k.status === "cancelled") {
      continue;
    }
    const where = open.find((c) => k.cycle_ids.includes(c.id));
    if (where) counts.set(where.id, (counts.get(where.id) ?? 0) + 1);
  }
  return open.filter((c) => counts.has(c.id)).map((c) => ({
    short: cycleShort(c.name),
    n: counts.get(c.id)!,
  }));
}
