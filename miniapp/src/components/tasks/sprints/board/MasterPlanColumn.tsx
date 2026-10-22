"use client";
import type { BoardPlanGroup, BoardPlanTask, SprintCycle } from "@/types";
import { byNumberedName } from "@/lib/initiatives";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { BoardCard } from "./BoardCard";
import type { BoardCtx } from "./boardCtx";
import { dueCycle, isClosedStatus, planTaskMatches } from "./boardModel";
import { TaskMenu } from "./TaskMenu";

// Мастер-план — левая колонка доски (решение владельца 22.10.2026: «мастер-план у нас держится,
// никуда не уезжает, а все остальные столбцы можно сдвигать»). На компьютере закреплён
// стоит вне прокрутки (SprintBoardView ставит её рядом с прокручиваемой полосой колонок), на
// телефоне — первая из колонок по одной. Раньше была `sticky` с глухим фоном поверх колонок:
// колонка спринта выходила вплотную к скруглённым углам, а в тёмной теме фон не совпадал с
// подсвеченным фоном страницы. Теперь колонки просто обрезаются у края своей полосы.
// Группы → задачи, у каждой полоска спринтов (закрашены её спринты, рамка — идущий).

// Сколько принятых спринтов показывать в полоске: их со временем десятки, а задаче важны
// ближайшие. Принятый, в котором задача была, показывается всегда.
const PAST_CELLS = 2;

type Node = { task: BoardPlanTask; kids: Node[] };

function byOpenThenCreated(a: Node, b: Node): number {
  const ca = isClosedStatus(a.task.status);
  const cb = isClosedStatus(b.task.status);
  if (ca !== cb) return ca ? 1 : -1;
  return a.task.created_at.localeCompare(b.task.created_at);
}

/** Подзадача — под родителем, если родитель в той же группе; иначе своей строкой (как в «Плане»). */
function buildTree(tasks: readonly BoardPlanTask[]): Node[] {
  const nodes = new Map(
    tasks.map((t) => [t.id, { task: t, kids: [] as Node[] }]),
  );
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    const parent = n.task.parent_id ? nodes.get(n.task.parent_id) : undefined;
    if (parent) parent.kids.push(n);
    else roots.push(n);
  }
  for (const n of nodes.values()) n.kids.sort(byOpenThenCreated);
  return roots.sort(byOpenThenCreated);
}

/** Родитель остаётся, если подошла хотя бы одна подзадача: иначе найденная осталась бы без контекста. */
function filterTree(
  nodes: Node[],
  keep: (t: BoardPlanTask) => boolean,
  hideDone: boolean,
): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const kids = filterTree(n.kids, keep, hideDone);
    const own = keep(n.task) && !(hideDone && isClosedStatus(n.task.status));
    if (own || kids.length > 0) out.push({ task: n.task, kids });
  }
  return out;
}

function Strip(
  { task, cycles }: { task: BoardPlanTask; cycles: readonly SprintCycle[] },
) {
  const dt = useDt();
  const past = cycles.filter((c) => c.status === "accepted");
  const shownPast = new Set([
    ...past.slice(-PAST_CELLS).map((c) => c.id),
    ...past.filter((c) => task.cycle_ids.includes(c.id)).map((c) => c.id),
  ]);
  const cells = cycles.filter((c) =>
    c.status !== "accepted" || shownPast.has(c.id)
  );
  if (cells.length === 0) return null;
  const names = cycles.filter((c) => task.cycle_ids.includes(c.id)).map((c) =>
    c.name
  );
  return (
    <span
      className="inline-flex items-center gap-[2px]"
      title={names.length > 0
        ? names.join(", ")
        : dt("ни в одном спринте", "in no sprint")}
      data-testid="plan-strip"
    >
      {cells.map((c) => {
        const on = task.cycle_ids.includes(c.id);
        return (
          <i
            key={c.id}
            className={cn(
              "inline-block h-1.5 w-3.5 rounded-[2px]",
              on
                ? (c.status === "accepted"
                  ? "bg-accent-ink/40"
                  : "bg-accent-ink")
                : "bg-line",
              c.status === "active" &&
                "outline-[1.5px] outline-offset-1 outline-primary",
            )}
          />
        );
      })}
    </span>
  );
}

function PlanCard({ node, nested, cycles, ctx }: {
  node: Node;
  nested: boolean;
  cycles: readonly SprintCycle[];
  ctx: BoardCtx;
}) {
  const t = node.task;
  const closed = isClosedStatus(t.status);
  const names = ctx.namesFor(t.id, t.assignees);
  const payload = ctx.canDrag && !closed
    ? ({ kind: "plan", taskId: t.id } as const)
    : null;
  return (
    <>
      <BoardCard
        title={t.title}
        closed={closed}
        nested={nested}
        strip={<Strip task={t} cycles={cycles} />}
        due={t.due_date
          ? { date: t.due_date, flag: !!dueCycle(cycles, t.due_date) }
          : null}
        assignee={names[0] ?? null}
        moreAssignees={Math.max(0, names.length - 1)}
        onToggleDone={() => ctx.toggleDone(t.id, t.status)}
        onOpen={() => ctx.openTask(t.id)}
        drag={payload
          ? {
            onDragStart: ctx.dragStart(payload),
            onDragEnd: ctx.dragEnd,
            dragging: ctx.dragging?.kind === "plan" &&
              ctx.dragging.taskId === t.id,
          }
          : undefined}
        menu={
          <TaskMenu
            title={t.title}
            taskStatus={t.status}
            cycles={ctx.cycles}
            taskCycleIds={t.cycle_ids}
            actions={ctx.menuActions(t.id)}
          />
        }
      />
      {node.kids.map((k) => (
        <PlanCard key={k.task.id} node={k} nested cycles={cycles} ctx={ctx} />
      ))}
    </>
  );
}

/** Склонение «задача» по числу: 1 задача, 2 задачи, 5 задач. */
function tasksRu(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "задача";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "задачи";
  return "задач";
}

export function MasterPlanColumn(
  { groups, cycles, ctx, hideDone, onHideDone, onAddTask }: {
    groups: readonly BoardPlanGroup[];
    cycles: readonly SprintCycle[];
    ctx: BoardCtx;
    hideDone: boolean;
    onHideDone: (v: boolean) => void;
    onAddTask: (groupId: string) => void;
  },
) {
  const dt = useDt();
  const all = groups.flatMap((g) => g.tasks);
  const done = all.filter((t) => isClosedStatus(t.status)).length;
  const filtering = !!ctx.filter.query.trim() || !!ctx.filter.person ||
    ctx.filter.attention;
  const keep = (t: BoardPlanTask) =>
    planTaskMatches(t, ctx.namesFor(t.id, t.assignees), ctx.filter);
  const sorted = [...groups].sort((a, b) => byNumberedName(a.name, b.name));
  const shown = sorted.map((g) => ({
    group: g,
    tree: filterTree(buildTree(g.tasks), keep, hideDone),
  }))
    // С поиском пустые группы прячутся; без него видны — в них заводят первую задачу.
    .filter((x) => !filtering || x.tree.length > 0);

  return (
    <div
      className="h-full shrink-0 snap-start pl-4 lg:pb-3 lg:pr-3"
      data-testid="master-plan"
    >
      <section
        aria-label={dt("Мастер-план", "Master plan")}
        className="flex h-full min-h-0 w-[calc(100vw-3.5rem)] flex-col rounded-[12px] border border-line bg-surface sm:w-[340px]"
      >
        <div className="shrink-0 border-b border-line px-3 pb-2 pt-2.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink" style={{ fontSize: 14 }}>
              {dt("Мастер-план", "Master plan")}
            </span>
            <span className="text-[12px] text-ink-mute">
              {dt(
                `${all.length} ${tasksRu(all.length)} · готово ${done}`,
                `${all.length} ${
                  all.length === 1 ? "task" : "tasks"
                } · ${done} done`,
              )}
            </span>
          </div>
          <label
            className="mt-1 flex cursor-pointer select-none items-center gap-1.5 text-ink-soft"
            style={{ fontSize: 12 }}
          >
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => onHideDone(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            {dt("Скрыть готовые", "Hide done")}
          </label>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {shown.map(({ group, tree }) => (
            <div key={group.id} className="flex flex-col gap-1.5">
              <div
                className="mx-1 mt-1.5 font-semibold uppercase tracking-[0.04em] text-ink-mute"
                style={{ fontSize: 11 }}
              >
                {group.name}
              </div>
              {tree.map((n) => (
                <PlanCard
                  key={n.task.id}
                  node={n}
                  nested={false}
                  cycles={cycles}
                  ctx={ctx}
                />
              ))}
              {!filtering && (
                <button
                  type="button"
                  onClick={() => onAddTask(group.id)}
                  className="rounded-[9px] border border-dashed border-line-2 px-2 py-1.5 text-center text-ink-mute transition-colors hover:border-accent-line hover:text-ink"
                  style={{ fontSize: 12.5 }}
                >
                  {dt("+ Задача в план", "+ Task to the plan")}
                </button>
              )}
            </div>
          ))}
          {shown.length === 0 && (
            <p
              className="px-2 py-4 text-center text-ink-mute"
              style={{ fontSize: 12.5 }}
            >
              {filtering
                ? dt(
                  "Под фильтр ничего не подошло",
                  "Nothing matches the filter",
                )
                : dt(
                  "В пространстве нет групп задач",
                  "No task groups in this space",
                )}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
