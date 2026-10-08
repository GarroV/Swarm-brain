"use client";
// Панель «План» экрана спринтов (решение владельца 07.10.2026,
// docs/decisions/2026-10-07-sprint-plan-tree.md): весь большой проект пространства одним
// деревом — группы → задачи → подзадачи, сделанные и несделанные. Заменила шторку «Взять из
// бэклога». Задачу берут в спринт перетаскиванием на список или кнопкой «→» у строки
// (на телефоне перетаскивания нет — только кнопка).
//
// Что входит в план и как считается — lib/sprintPlan.ts под тестами; здесь только вид.
import { useMemo, useState } from "react";
import type { Project, Task, User } from "@/types";
import { buildPlan, canTake, type PlanTask } from "@/lib/sprintPlan";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { AssigneeChip, ProgressBar } from "./atoms";
import { useStoredFlag } from "./useStoredFlag";

/** Тип данных перетаскивания «задача плана» — по нему список спринта узнаёт свой бросок. */
export const PLAN_DRAG_MIME = "application/x-swarm-plan-task";

const STATUS_TONE: Record<string, string> = {
  done: "bg-status-done",
  in_progress: "bg-status-prog",
  cancelled: "bg-ink-mute",
};

type Props = {
  tasks: readonly Task[];
  projects: readonly Project[];
  users: readonly User[];
  space: string | null;
  spaceName: string;
  inSprint: ReadonlySet<string>;
  /** Взять в спринт. Нет — спринт не принимает задачи (принят или не выбран). */
  onTake?: (taskId: string) => void;
  /** Завести задачу в группу плана (в спринт она при этом не идёт). */
  onAdd?: (projectId: string) => void;
  onOpen: (task: Task) => void;
  onClose: () => void;
  /** Перетаскивание мышью — только на компьютере. */
  canDrag: boolean;
  busy: boolean;
};

export function PlanPanel(p: Props) {
  const dt = useDt();
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useStoredFlag(
    "swarm.sprints.planHideDone",
    false,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const plan = useMemo(
    () =>
      buildPlan(p.tasks, p.projects, p.space, p.inSprint, { query, hideDone }),
    [p.tasks, p.projects, p.space, p.inSprint, query, hideDone],
  );
  const percent = plan.total > 0
    ? Math.round((plan.done / plan.total) * 100)
    : 0;
  const searching = query.trim().length > 0;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      aria-label={dt("План", "Plan")}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[10px] border border-line bg-surface"
    >
      <header className="shrink-0 border-b border-line px-3 pb-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-ink" style={{ fontSize: 13.5 }}>
            {dt("План", "Plan")}
          </h3>
          <span
            className="min-w-0 truncate text-ink-mute"
            style={{ fontSize: 12 }}
          >
            {p.spaceName}
          </span>
          <button
            type="button"
            onClick={p.onClose}
            title={dt("Скрыть план", "Hide the plan")}
            aria-label={dt("Скрыть план", "Hide the plan")}
            className="ml-auto rounded-full p-1 text-ink-mute hover:bg-surface-2 hover:text-ink"
          >
            <RoyIcon name="x" size={13} />
          </button>
        </div>
        {/* Итог плана сверху — ответ на «сколько сделано всего», до разбивки по группам. */}
        <div className="mt-2 flex items-center gap-2.5">
          <ProgressBar percent={percent} className="flex-1" />
          <span
            className="shrink-0 font-mono text-ink-soft"
            style={{ fontSize: 11.5 }}
          >
            {dt(
              `${plan.done} из ${plan.total}`,
              `${plan.done} of ${plan.total}`,
            )}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border border-line bg-background px-2 focus-within:border-accent-line">
            <RoyIcon
              name="search"
              size={12}
              className="shrink-0 text-ink-mute"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={dt("Поиск по плану", "Search the plan")}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 12.5 }}
            />
          </label>
          <label
            className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-ink-soft"
            style={{ fontSize: 12 }}
          >
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            {dt("Скрыть готовые", "Hide done")}
          </label>
        </div>
        {p.onTake && p.canDrag && plan.available > 0 && (
          <p className="mt-2 text-ink-mute" style={{ fontSize: 11.5 }}>
            {dt(
              "Перетащите задачу на список спринта или нажмите →",
              "Drag a task onto the sprint list or press →",
            )}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {plan.groups.length === 0 && (
          <p
            className="px-3 py-6 text-center text-ink-mute"
            style={{ fontSize: 12.5 }}
          >
            {searching ? dt("Ничего не нашлось", "Nothing found") : dt(
              "В плане пока нет групп. Заведите первую кнопкой «Добавить группу» над списком спринта.",
              "The plan has no groups yet. Create one with “Add group” above the sprint list.",
            )}
          </p>
        )}
        {plan.groups.map((g) => {
          const isCollapsed = collapsed.has(g.project.id) && !searching;
          const complete = g.total > 0 && g.done === g.total;
          return (
            <div
              key={g.project.id}
              className="border-b border-line/60 last:border-b-0"
            >
              <div className="group/plan flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => toggle(g.project.id)}
                  aria-expanded={!isCollapsed}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                >
                  <RoyIcon
                    name="cright"
                    size={9}
                    strokeWidth={2.4}
                    className={cn(
                      "shrink-0 text-ink-mute transition-transform",
                      !isCollapsed && "rotate-90",
                    )}
                  />
                  <span
                    className="min-w-0 truncate font-semibold text-ink"
                    style={{ fontSize: 12.5 }}
                  >
                    {g.project.name}
                  </span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 font-mono",
                      complete ? "text-status-done" : "text-ink-mute",
                    )}
                    style={{ fontSize: 11 }}
                  >
                    {g.done}/{g.total}
                  </span>
                </button>
                {p.onAdd && (
                  <button
                    type="button"
                    onClick={() => p.onAdd?.(g.project.id)}
                    title={dt(
                      "Добавить задачу в группу",
                      "Add a task to the group",
                    )}
                    aria-label={dt(
                      "Добавить задачу в группу",
                      "Add a task to the group",
                    )}
                    className="grid size-6 shrink-0 place-items-center rounded-full text-ink-mute transition-opacity hover:bg-surface-2 hover:text-ink lg:opacity-0 lg:group-hover/plan:opacity-100 lg:focus-visible:opacity-100"
                  >
                    <RoyIcon name="plus" size={12} strokeWidth={2.2} />
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <div className="pb-1.5">
                  {g.tasks.length === 0 && (
                    <p
                      className="px-3 pb-1.5 pl-[30px] text-ink-mute"
                      style={{ fontSize: 12 }}
                    >
                      {hideDone && g.total > 0
                        ? dt("Всё сделано", "All done")
                        : dt("Задач пока нет", "No tasks yet")}
                    </p>
                  )}
                  {g.tasks.map((t) => (
                    <PlanRow
                      key={t.task.id}
                      node={t}
                      depth={0}
                      users={p.users}
                      onTake={p.onTake}
                      onOpen={p.onOpen}
                      canDrag={p.canDrag}
                      busy={p.busy}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type RowProps =
  & Pick<Props, "users" | "onTake" | "onOpen" | "canDrag" | "busy">
  & {
    node: PlanTask;
    depth: number;
  };

function PlanRow(
  { node, depth, users, onTake, onOpen, canDrag, busy }: RowProps,
) {
  const dt = useDt();
  const { task } = node;
  const takeable = !!onTake && canTake(node);
  const draggable = takeable && canDrag && !busy;
  const assignee = task.assignees[0] ??
    users.find((u) => task.assignee_telegram_ids.includes(u.telegram_id))
      ?.name ??
    null;
  return (
    <>
      <div
        draggable={draggable}
        onDragStart={draggable
          ? (e) => {
            e.dataTransfer.setData(PLAN_DRAG_MIME, task.id);
            e.dataTransfer.effectAllowed = "copy";
          }
          : undefined}
        className={cn(
          "group/row flex items-center gap-2 py-[5px] pr-2 transition-colors hover:bg-surface-2",
          draggable && "cursor-grab active:cursor-grabbing",
        )}
        style={{ paddingLeft: 30 + depth * 16 }}
      >
        <span
          className={cn(
            "size-[7px] shrink-0 rounded-full",
            STATUS_TONE[task.status] ?? "bg-status-open",
          )}
        />
        <button
          type="button"
          onClick={() => onOpen(task)}
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            node.closed ? "text-ink-mute line-through" : "text-ink",
          )}
          style={{ fontSize: 12.5 }}
          title={task.title}
        >
          {task.title}
        </button>
        {node.inSprint && (
          <span
            className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px font-medium text-primary"
            style={{ fontSize: 10.5 }}
          >
            {dt("в спринте", "in sprint")}
          </span>
        )}
        {task.status === "cancelled" && (
          <span className="shrink-0 text-ink-mute" style={{ fontSize: 10.5 }}>
            {dt("отменена", "cancelled")}
          </span>
        )}
        <AssigneeChip name={assignee} />
        {takeable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onTake?.(task.id)}
            title={dt("Взять в спринт", "Take into the sprint")}
            aria-label={dt("Взять в спринт", "Take into the sprint")}
            className="grid size-6 shrink-0 place-items-center rounded-full text-ink-mute transition-opacity hover:bg-primary/10 hover:text-primary disabled:opacity-40 lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-visible:opacity-100"
          >
            <RoyIcon name="arrow" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {node.kids.map((k) => (
        <PlanRow
          key={k.task.id}
          node={k}
          depth={depth + 1}
          users={users}
          onTake={onTake}
          onOpen={onOpen}
          canDrag={canDrag}
          busy={busy}
        />
      ))}
    </>
  );
}
