// Модель экрана «Лента времени» спринтов (стенд, решение 12.11.2026): из ответа доски
// (`GET /sprint-cycles/board`) собирает столбцы-спринты, строки-задачи с отрезками и переносы.
// Чистые функции без React и сети: геометрия и состояния ленты проверяются тестом, а не глазом.
import type {
  BoardPlanTask,
  SprintBoardData,
  SprintCycle,
  SprintCycleItem,
} from "@/types";

/** Вес столбца в ширине ленты: идущий спринт широкий (в нём дни), прошлые узкие, будущие средние. */
const WEIGHT = { past: 1, current: 3, future: 1.5 } as const;
/** Сколько принятых спринтов слева и запланированных справа показываем. */
export const PAST_VISIBLE = 2;
export const FUTURE_VISIBLE = 2;

export type ColKind = keyof typeof WEIGHT;

export type TimelineCol = {
  cycle: SprintCycle;
  kind: ColKind;
  /** Левый край и ширина в процентах ширины ленты. */
  left: number;
  width: number;
  /** Строки спринта (состав); у принятых без состава — пусто. */
  items: SprintCycleItem[];
  /** Снимки ушедших переносом (у принятых — из `extraMoved`). */
  moved: SprintCycleItem[];
};

export type BarState =
  | "done"
  | "work"
  | "risk"
  | "problem"
  | "planned"
  | "extra"
  | "cancelled";

/** Перенос задачи из столбца `from` в `to` (null — спринт-цель удалён или вне окна). */
export type MoveMark = {
  from: number;
  to: number | null;
  snapshot: SprintCycleItem;
};

export type TaskRowModel = {
  task: BoardPlanTask;
  /** Индексы столбцов, где задача живёт, по порядку; пусто — только перенос. */
  cols: number[];
  state: BarState;
  moves: MoveMark[];
  attention: boolean;
};

export type GroupModel = {
  id: string;
  name: string;
  rows: TaskRowModel[];
  /** Задач группы вне окна ленты (в плане, но не в показанных спринтах). */
  hidden: number;
};

const DAY_MS = 86_400_000;
export const dayNum = (iso: string): number =>
  Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);

/** Окно ленты: последние принятые, идущий и ближайшие запланированные — слева направо. */
export function buildColumns(
  data: SprintBoardData,
  extraMoved: ReadonlyMap<string, SprintCycleItem[]>,
): TimelineCol[] {
  const sorted = [...data.cycles].sort((a, b) =>
    a.cycle.start_date.localeCompare(b.cycle.start_date)
  );
  const past = sorted.filter((c) => c.cycle.status === "accepted").slice(
    -PAST_VISIBLE,
  );
  const active = sorted.filter((c) => c.cycle.status === "active");
  const future = sorted.filter((c) => c.cycle.status === "draft").slice(
    0,
    FUTURE_VISIBLE,
  );
  const picked = [
    ...past.map((c) => ({ c, kind: "past" as const })),
    ...active.map((c) => ({ c, kind: "current" as const })),
    ...future.map((c) => ({ c, kind: "future" as const })),
  ];
  const total = picked.reduce((s, p) => s + WEIGHT[p.kind], 0) || 1;
  let acc = 0;
  return picked.map(({ c, kind }) => {
    const left = (acc / total) * 100;
    acc += WEIGHT[kind];
    return {
      cycle: c.cycle,
      kind,
      left,
      width: (WEIGHT[kind] / total) * 100,
      items: c.items,
      moved: c.loaded ? c.moved : (extraMoved.get(c.cycle.id) ?? []),
    };
  });
}

/** Доля дня внутри столбца (0..1): для линий «сегодня» и «сверка». null — дата вне спринта. */
export function dayFraction(cycle: SprintCycle, day: string): number | null {
  const start = dayNum(cycle.start_date);
  const len = dayNum(cycle.end_date) - start + 1;
  const n = dayNum(day) - start;
  if (len <= 0 || n < 0 || n >= len) return null;
  return (n + 0.5) / len;
}

/** Положение в процентах ширины ленты. */
export const colPos = (col: TimelineCol, fraction: number): number =>
  col.left + col.width * fraction;

const isClosed = (s: string) => s === "done" || s === "cancelled";

function stateOf(
  task: BoardPlanTask,
  cols: TimelineCol[],
  idx: number[],
): BarState {
  if (task.status === "cancelled") return "cancelled";
  if (task.status === "done") return "done";
  const lastIdx = idx[idx.length - 1];
  const item = cols[lastIdx].items.find((i) =>
    i.task_id === task.id && !i.removed
  );
  if (item?.check_status === "problem") return "problem";
  if (item?.check_status === "risk") return "risk";
  if (
    cols[lastIdx].kind === "future" &&
    idx.every((i) => cols[i].kind === "future")
  ) return "planned";
  if (item && !item.in_plan && cols[lastIdx].kind === "current") return "extra";
  return "work";
}

/** Строки ленты по группам мастер-плана. `names` — исполнители задачи (для фильтра по человеку). */
export function buildGroups(
  data: SprintBoardData,
  cols: TimelineCol[],
): GroupModel[] {
  const colIdx = new Map(cols.map((c, i) => [c.cycle.id, i]));
  const movesByTask = new Map<string, MoveMark[]>();
  cols.forEach((c, from) => {
    for (const snap of c.moved) {
      if (!snap.task_id || !snap.moved) continue;
      const to = snap.moved.to_cycle_id
        ? (colIdx.get(snap.moved.to_cycle_id) ?? null)
        : null;
      movesByTask.set(snap.task_id, [...(movesByTask.get(snap.task_id) ?? []), {
        from,
        to,
        snapshot: snap,
      }]);
    }
  });
  return data.plan.groups.map((g) => {
    const rows: TaskRowModel[] = [];
    for (const task of g.tasks) {
      const idx = task.cycle_ids.flatMap((
        id,
      ) => (colIdx.has(id) ? [colIdx.get(id)!] : []));
      const moves = movesByTask.get(task.id) ?? [];
      if (idx.length === 0 && moves.length === 0) continue;
      const attention = moves.some((m) => m.snapshot.moved?.reason === null) ||
        idx.some((i) =>
          cols[i].items.some((it) =>
            it.task_id === task.id && needsAttention(it)
          )
        );
      rows.push({
        task,
        cols: idx,
        state: idx.length
          ? stateOf(task, cols, idx)
          : isClosed(task.status)
          ? "done"
          : "work",
        moves,
        attention,
      });
    }
    return {
      id: g.id,
      name: g.name,
      rows,
      hidden: g.tasks.length - rows.length,
    };
  }).filter((g) => g.rows.length > 0);
}

function needsAttention(
  i: SprintCycleItem,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (isClosed(i.status) || i.removed) return false;
  return i.check_status === "risk" || i.check_status === "problem" ||
    (!!i.due_date && i.due_date.slice(0, 10) < today);
}

export type Summary = {
  current: TimelineCol | null;
  done: number;
  total: number;
  daysToEnd: number | null;
  /** Дней до сверки: отрицательное — прошла; null — не назначена. */
  daysToCheck: number | null;
  burning: number;
  lastAccepted: {
    name: string;
    planDone: number;
    plan: number;
    carried: number;
  } | null;
};

export function summarize(cols: TimelineCol[], today: string): Summary {
  const current = cols.find((c) => c.kind === "current") ?? null;
  const items = current?.items.filter((i) => !i.removed) ?? [];
  const lastPast = [...cols].reverse().find((c) => c.kind === "past");
  const stats = lastPast?.cycle.stats ?? null;
  const burning = cols.reduce(
    (n, c) =>
      n + c.items.filter((i) => needsAttention(i, today)).length +
      c.moved.filter((m) => m.moved?.reason === null).length,
    0,
  );
  return {
    current,
    done: items.filter((i) => i.status === "done").length,
    total: items.length,
    daysToEnd: current
      ? dayNum(current.cycle.end_date) - dayNum(today) + 1
      : null,
    daysToCheck: current?.cycle.check_date
      ? dayNum(current.cycle.check_date) - dayNum(today)
      : null,
    burning,
    lastAccepted: lastPast && stats
      ? {
        name: lastPast.cycle.name,
        planDone: stats.planDone,
        plan: stats.plan,
        carried: stats.carried,
      }
      : null,
  };
}
