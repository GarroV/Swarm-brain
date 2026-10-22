"use client";
import type { BoardPlanGroup, BoardPlanTask, SprintCycle } from "@/types";
import { byNumberedName } from "@/lib/initiatives";
import { planLine } from "@/lib/sprintLabels";
import { fmtDayShort } from "../format";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { BoardCard } from "./BoardCard";
import { type BoardCtx, PLAN_COL } from "./boardCtx";
import { UnlinkDrop } from "./BoardColumn";
import { isClosedStatus, planTaskMatches } from "./boardModel";
import { TaskMenu } from "./TaskMenu";

// Мастер-план — левая колонка доски (решение владельца 22.10.2026: «мастер-план у нас держится,
// никуда не уезжает, а все остальные столбцы можно сдвигать»). На компьютере закреплён
// стоит вне прокрутки (SprintBoardView ставит её рядом с прокручиваемой полосой колонок), на
// телефоне — первая из колонок по одной. Раньше была `sticky` с глухим фоном поверх колонок:
// колонка спринта выходила вплотную к скруглённым углам, а в тёмной теме фон не совпадал с
// подсвеченным фоном страницы. Теперь колонки просто обрезаются у края своей полосы.
// Два раздела: «Не взяты» (ни в одном незакрытом спринте) сверху и «В спринтах» ниже; внутри —
// группы → задачи. Под задачей одна строка «С4 → С6 · 🏁 01.12» вместо полоски (решение
// владельца 22.10.2026, п.14: «что будет, когда спринты перевалятся за десятку?»).

type Node = { task: BoardPlanTask; kids: Node[]; nestedUnder?: boolean };

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

/** Строка под задачей: отрезок незакрытых спринтов, срок, переносы. */
function PlanLine(
  { task, cycles }: { task: BoardPlanTask; cycles: readonly SprintCycle[] },
) {
  const dt = useDt();
  const line = planLine(task, cycles);
  const closed = isClosedStatus(task.status);
  if (line.kind === "none") {
    if (closed) return null;
    return (
      <div
        className="col-span-2 col-start-2 -mt-0.5 text-pri-med/90"
        style={{ fontSize: 11.5 }}
        data-testid="plan-line"
      >
        {dt("не в спринтах", "not in sprints")}
      </div>
    );
  }
  const names = cycles.filter((c) =>
    c.status !== "accepted" && task.cycle_ids.includes(c.id)
  ).map((c) => c.name).join(", ");
  return (
    <div
      className="col-span-2 col-start-2 -mt-0.5 flex flex-wrap items-center gap-x-1.5 text-ink-soft"
      style={{ fontSize: 11.5 }}
      title={names}
      data-testid="plan-line"
    >
      <span className="font-medium tabular-nums">
        {line.from}
        {line.to ? ` → ${line.to}` : ""}
      </span>
      {line.due && (
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            line.due.longer && !closed && "font-semibold text-pri-high",
          )}
        >
          · 🏁 {fmtDayShort(line.due.date)}
          {line.due.longer && !closed
            ? ` · ${dt("план дольше срока", "plan runs past the deadline")}`
            : ""}
        </span>
      )}
      {task.moves > 0 && (
        <span className="whitespace-nowrap text-pri-med">
          · {dt(`перенос ×${task.moves}`, `moved ×${task.moves}`)}
        </span>
      )}
    </div>
  );
}

function PlanCard({ node, cycles, ctx }: {
  node: Node;
  cycles: readonly SprintCycle[];
  ctx: BoardCtx;
}) {
  const dt = useDt();
  const t = node.task;
  const closed = isClosedStatus(t.status);
  const names = ctx.namesFor(t.id, t.assignees);
  const payload = ctx.canDrag && !closed
    ? ({ kind: "plan", taskId: t.id } as const)
    : null;
  const parent = t.parent_id ? ctx.planById.get(t.parent_id) : undefined;
  const line = planLine(t, cycles);
  const kids = ctx.kidsOf(t.id);
  // Подзадачи, которых нет под этим родителем (отфильтрованы или в другой группе), — «+ ещё N».
  const shownKids = new Set(node.kids.map((k) => k.task.id));
  const hidden = kids.filter((k) => !shownKids.has(k.id)).length;
  return (
    <>
      <BoardCard
        title={t.title}
        closed={closed}
        dnd={ctx.cardDnd(t.id, PLAN_COL)}
        plan={<PlanLine task={t} cycles={cycles} />}
        subtasks={kids.length > 0
          ? {
            done: kids.filter((x) => isClosedStatus(x.status)).length,
            total: kids.length,
          }
          : undefined}
        parentNote={parent && !node.nestedUnder
          ? { title: parent.title, onOpen: () => ctx.openTask(parent.id) }
          : undefined}
        due={line.kind === "none" && t.due_date ? { date: t.due_date } : null}
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
      {(node.kids.length > 0 || hidden > 0) && (
        <div
          className="ml-3 flex flex-col gap-1.5 border-l-2 border-line pl-2"
          data-testid="ladder"
        >
          {node.kids.map((k) => (
            <PlanCard
              key={k.task.id}
              node={{ ...k, nestedUnder: true }}
              cycles={cycles}
              ctx={ctx}
            />
          ))}
          {hidden > 0 && (
            <div className="px-1 text-ink-mute" style={{ fontSize: 11.5 }}>
              {dt(`+ ещё ${hidden}`, `+ ${hidden} more`)}
            </div>
          )}
        </div>
      )}
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
  const trees = sorted.map((g) => ({
    group: g,
    tree: filterTree(buildTree(g.tasks), keep, hideDone),
  }));
  // «Не взяты» — незакрытая задача без единого незакрытого спринта; всё остальное, включая
  // готовые, — «В спринтах». Раздел определяет корень: подзадачи едут под родителем.
  const isNew = (n: Node) =>
    !isClosedStatus(n.task.status) && planLine(n.task, cycles).kind === "none";
  const countTasks = (nodes: Node[]): number =>
    nodes.reduce((n, x) => n + 1 + countTasks(x.kids), 0);
  const section = (taken: boolean) =>
    trees.map(({ group, tree }) => ({
      group,
      tree: tree.filter((n) => isNew(n) !== taken),
    }))
      // С поиском пустые группы прячутся; без него в «Не взяты» они видны — в них заводят задачу.
      .filter((x) => x.tree.length > 0 || (!taken && !filtering));
  const notTaken = section(false);
  const inSprints = section(true);
  const count = (xs: typeof notTaken) =>
    xs.reduce((n, x) => n + countTasks(x.tree), 0);
  const unlink = ctx.unlinkZone(PLAN_COL);

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
        <div
          data-board-scroll
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
        >
          {[
            {
              key: "new",
              title: dt("Не взяты", "Not taken"),
              list: notTaken,
              add: true,
            },
            {
              key: "in",
              title: dt("В спринтах", "In sprints"),
              list: inSprints,
              add: false,
            },
          ].map((sec) =>
            sec.list.length === 0 && sec.key === "in" ? null : (
              <div
                key={sec.key}
                className="flex flex-col gap-1.5"
                data-testid={`plan-section-${sec.key}`}
              >
                <div
                  className="sticky top-0 z-[1] -mx-2 border-b border-line bg-surface px-3 py-1 font-semibold text-ink"
                  style={{ fontSize: 12.5 }}
                >
                  {sec.title} · {count(sec.list)}
                </div>
                {sec.list.map(({ group, tree }) => (
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
                        cycles={cycles}
                        ctx={ctx}
                      />
                    ))}
                    {sec.add && !filtering && (
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
              </div>
            )
          )}
          {notTaken.length === 0 && inSprints.length === 0 && (
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
          {unlink && <UnlinkDrop zone={unlink} />}
        </div>
      </section>
    </div>
  );
}
