// «Ход задачи» — путь задачи по спринтам (решение владельца 22.10.2026, этап 4 плана доски:
// «можно посмотреть аналитику по задаче — где, что, когда, как»). Чистая функция: данные ей
// приносит `sprint-journey-load.ts`, чтобы правило раскладки было под тестами без базы.
//
// Правила (спека, «Ход задачи» и «Правила на граничные случаи»):
//   * шаг — строка задачи в спринте, по дате начала спринта; снятая из спринта строка — шаг
//     «снята» и в число спринтов не входит;
//   * комментарий попадает в спринт по `created_at`: в последний спринт, начавшийся не позже
//     него; зазор между спринтами — ближайший предыдущий; до первого спринта — никуда;
//   * комментарии-причины переноса и плана («Перенос (…): …») апдейтами не считаются;
//   * срок на входе и выходе — по истории изменений срока (`task_history`), не по сроку «сейчас».

export interface JourneyTask {
  title: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
}

export interface JourneyRow {
  cycle_id: string;
  moved_at: string | null;
  moved_to_cycle_id: string | null;
  moved_by: string | null;
  carry_reason: string | null;
  withdrawn_at: string | null;
  plan_reason: string | null;
}

export interface JourneyCycle {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface JourneyComment {
  id: string;
  content: string;
  added_by: string;
  created_at: string;
}

/** Смена срока задачи из `task_history` (field = due_date). */
export interface DueChange {
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export type StepOutcome =
  | { kind: "done"; at: string; onTime: boolean | null }
  | { kind: "cancelled"; at: string | null }
  | { kind: "moved" }
  | { kind: "withdrawn" }
  | { kind: "continued" }
  | { kind: "inProgress" }
  | { kind: "planned" }
  | { kind: "open" };

export interface JourneyStep {
  cycle: JourneyCycle;
  dueIn: string | null;
  dueOut: string | null;
  comments: JourneyComment[];
  move: { toName: string | null; reason: string | null; by: string | null; at: string } | null;
  planReason: string | null;
  outcome: StepOutcome;
}

export interface Journey {
  summary: {
    sprints: number;
    moves: number;
    updates: number;
    daysInWork: number;
    /** Дней от первого срока до закрытия (или до сегодня); меньше нуля — впереди срока; null — срока не было. */
    lateDays: number | null;
  };
  steps: JourneyStep[];
}

const DAY = 86_400_000;
const REASON_PREFIX = /^(Перенос|Carry-over|План работы|Work plan) \(/;

/** Начало дня спринта — полночь UTC, как у дат без пояса (sprint-dates.ts). */
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`);
const dayEnd = (d: string) => Date.parse(`${d}T23:59:59Z`);
const dateOf = (iso: string) => iso.slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((dayStart(a) - dayStart(b)) / DAY);

function dueAt(task: JourneyTask, changes: readonly DueChange[], at: number): string | null {
  if (changes.length === 0) return task.due_date;
  let due = changes[0].old_value;
  for (const c of changes) {
    if (Date.parse(c.created_at) <= at) due = c.new_value;
    else break;
  }
  return due;
}

export function buildJourney(input: {
  task: JourneyTask;
  rows: readonly JourneyRow[];
  cycles: readonly JourneyCycle[];
  comments: readonly JourneyComment[];
  dueChanges: readonly DueChange[];
  now: number;
}): Journey {
  const { task, now } = input;
  const byId = new Map(input.cycles.map((c) => [c.id, c]));
  const changes = [...input.dueChanges].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const entries = input.rows
    .map((row) => ({ row, cycle: byId.get(row.cycle_id) }))
    .filter((e): e is { row: JourneyRow; cycle: JourneyCycle } => !!e.cycle)
    .sort((a, b) => a.cycle.start_date.localeCompare(b.cycle.start_date));

  const live = entries.filter((e) => !e.row.withdrawn_at && !e.row.moved_at);
  const closedTask = task.status === "done" || task.status === "cancelled";
  const finishedAt = task.completed_at ? Date.parse(task.completed_at) : null;
  // Шаг, на котором задача закрылась: последний живой, начавшийся не позже закрытия.
  const finishing = !closedTask
    ? null
    : (finishedAt === null
      ? live.at(-1)
      : [...live].reverse().find((e) => dayStart(e.cycle.start_date) <= finishedAt) ?? live.at(-1)) ?? null;

  // Комментарии по окнам: последний шаг, начавшийся не позже комментария.
  const starts = entries.map((e) => dayStart(e.cycle.start_date));
  const bucket = entries.map(() => [] as JourneyComment[]);
  let updates = 0;
  for (const c of [...input.comments].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (REASON_PREFIX.test(c.content)) continue;
    const t = Date.parse(c.created_at);
    let idx = -1;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= t) idx = i;
    if (idx < 0) continue;
    bucket[idx].push(c);
    updates++;
  }

  const steps: JourneyStep[] = entries.map(({ row, cycle }, i) => {
    const start = dayStart(cycle.start_date);
    const exit = Math.max(
      start,
      Math.min(row.moved_at ? Date.parse(row.moved_at) : dayEnd(cycle.end_date), now),
    );
    const laterLive = live.some((e) => e.cycle.start_date > cycle.start_date);
    let outcome: StepOutcome;
    if (row.moved_at) outcome = { kind: "moved" };
    else if (row.withdrawn_at) outcome = { kind: "withdrawn" };
    else if (finishing && finishing.row === row) {
      outcome = task.status === "cancelled" ? { kind: "cancelled", at: task.completed_at } : {
        kind: "done",
        at: task.completed_at ?? "",
        onTime: task.completed_at && dueAt(task, changes, finishedAt!)
          ? dateOf(task.completed_at) <= dueAt(task, changes, finishedAt!)!
          : null,
      };
    } else if (laterLive) outcome = { kind: "continued" };
    else if (cycle.status === "active") outcome = { kind: "inProgress" };
    else if (cycle.status === "draft") outcome = { kind: "planned" };
    else outcome = { kind: "open" };

    return {
      cycle,
      dueIn: dueAt(task, changes, start),
      dueOut: dueAt(task, changes, exit),
      comments: bucket[i],
      move: row.moved_at
        ? {
          toName: row.moved_to_cycle_id ? byId.get(row.moved_to_cycle_id)?.name ?? null : null,
          reason: row.carry_reason,
          by: row.moved_by,
          at: row.moved_at,
        }
        : null,
      planReason: row.plan_reason,
      outcome,
    };
  });

  const counted = entries.filter((e) => !e.row.withdrawn_at);
  const started = counted.find((e) => dayStart(e.cycle.start_date) <= now);
  let daysInWork = 0;
  if (started) {
    const from = dayStart(started.cycle.start_date);
    const to = closedTask && finishedAt !== null ? finishedAt : now;
    daysInWork = Math.max(0, Math.floor((to - from) / DAY));
  }

  const firstDue = changes.length > 0 ? (changes[0].old_value ?? changes[0].new_value) : task.due_date;
  const endDate = closedTask && task.completed_at
    ? dateOf(task.completed_at)
    : new Date(now).toISOString().slice(0, 10);
  const lateDays = firstDue ? dayDiff(endDate, firstDue) : null;

  return {
    summary: {
      sprints: counted.length,
      moves: entries.filter((e) => e.row.moved_at).length,
      updates,
      daysInWork,
      lateDays,
    },
    steps,
  };
}
