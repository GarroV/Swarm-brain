"use client";
import { type DragEventHandler, useEffect, useState } from "react";
import type {
  SprintBoardCycle,
  SprintCycle,
  SprintCycleDetail,
  SprintCycleItem,
} from "@/types";
import { fetchSprintCycle } from "@/lib/api";
import { sprintKpi } from "@/lib/initiatives";
import { buildLadder, kidsElsewhere } from "@/lib/sprintLadder";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { AddTaskChip, ProgressBar, ProgressText } from "../atoms";
import { fmtDay, fmtRange } from "../format";
import { MovedSection } from "../SnapshotCard";
import { BoardCard, Tag } from "./BoardCard";
import { type BoardCtx, type UnlinkZone } from "./boardCtx";
import {
  dueCycle,
  groupItems,
  isClosedStatus,
  isEmptyAreaClick,
  itemMatches,
} from "./boardModel";
import { TaskMenu } from "./TaskMenu";

// Колонка спринта на доске: идущий — шире и с прогрессом, запланированные — обычные. Принятые
// спринты в ряду колонок не показываются (владелец 22.10.2026: «законченные спринты сразу
// изначально были спрятаны, чтобы не прятались за мастер-планом») — вход к ним «История
// спринтов»; состав принятого спринта приходит по запросу (`PastBody`) — на доске он не лежит.

export type ColumnDrop = {
  /** Сюда сейчас можно бросить то, что несут. */
  valid: boolean;
  /** Над колонкой. */
  over: boolean;
  handlers: {
    onDragOver: DragEventHandler<HTMLElement>;
    onDragLeave: DragEventHandler<HTMLElement>;
    onDrop: DragEventHandler<HTMLElement>;
  };
};

function ItemCard(
  { item, cycle, ctx, inColumn }: {
    item: SprintCycleItem;
    cycle: SprintCycle;
    ctx: BoardCtx;
    /** Задачи, стоящие в этой колонке: от них зависит, где родитель. */
    inColumn: ReadonlySet<string>;
  },
) {
  const dt = useDt();
  const plan = item.task_id ? ctx.planById.get(item.task_id) : undefined;
  const parent = plan?.parent_id ? ctx.planById.get(plan.parent_id) : undefined;
  const kids = plan ? ctx.kidsOf(plan.id) : [];
  const names = ctx.namesFor(item.task_id, item.assignees);
  const live = !!item.task_id && !item.frozen && !item.removed;
  const k = plan ? plan.cycle_ids.indexOf(cycle.id) + 1 : 0;
  const n = plan?.cycle_ids.length ?? 0;
  const closed = isClosedStatus(item.status);
  const dueFlag = !!item.due_date &&
    dueCycle(ctx.cycles, item.due_date)?.id === cycle.id;
  const editable = live && cycle.status !== "accepted";
  const dragPayload = editable && ctx.canDrag && !closed
    ? ({
      kind: "item",
      taskId: item.task_id!,
      itemId: item.id,
      fromCycleId: cycle.id,
    } as const)
    : null;
  return (
    <BoardCard
      title={item.title}
      closed={closed}
      dnd={ctx.cardDnd(item.task_id, cycle.id)}
      parentNote={parent && !inColumn.has(parent.id)
        ? { title: parent.title, onOpen: () => ctx.openTask(parent.id) }
        : undefined}
      subtasks={kids.length > 0
        ? {
          done: kids.filter((x) => isClosedStatus(x.status)).length,
          total: kids.length,
        }
        : undefined}
      mark={item.check_status}
      due={item.due_date ? { date: item.due_date, flag: dueFlag } : null}
      assignee={names[0] ?? null}
      moreAssignees={Math.max(0, names.length - 1)}
      onToggleDone={editable
        ? () => ctx.toggleDone(item.task_id!, item.status)
        : undefined}
      onOpen={live ? () => ctx.openTask(item.task_id!) : undefined}
      drag={dragPayload
        ? {
          onDragStart: ctx.dragStart(dragPayload),
          onDragEnd: ctx.dragEnd,
          dragging: ctx.dragging?.kind === "item" &&
            ctx.dragging.itemId === item.id,
        }
        : undefined}
      tags={
        <>
          {item.carry_count >= 1 && (
            <Tag tone="warn">
              {dt(
                `${item.carry_count + 1}-й спринт`,
                `sprint #${item.carry_count + 1}`,
              )}
            </Tag>
          )}
          {n > 1 && k > 0 && (
            <Tag tone="span">
              {dt(`спринт ${k} из ${n}`, `sprint ${k} of ${n}`)}
              {k < n && cycle.status === "active"
                ? dt(" · продолжится →", " · continues →")
                : ""}
            </Tag>
          )}
          {!item.in_plan && cycle.status === "active" && (
            <Tag>{dt("сверх плана", "extra")}</Tag>
          )}
          {item.check_status === "risk" && (
            <Tag tone="warn" title={item.check_note ?? undefined}>
              {dt("риск", "risk")}
            </Tag>
          )}
          {item.check_status === "problem" && (
            <Tag tone="bad" title={item.check_note ?? undefined}>
              {dt("проблема", "problem")}
            </Tag>
          )}
        </>
      }
      menu={editable
        ? (
          <TaskMenu
            title={item.title}
            taskStatus={item.status}
            item={item}
            cycle={cycle}
            cycles={ctx.cycles}
            taskCycleIds={plan?.cycle_ids ?? []}
            actions={ctx.menuActions(item.task_id!, item, cycle.id)}
          />
        )
        : undefined}
    />
  );
}

function CycleHeader(
  { entry, onClose, busy }: {
    entry: SprintBoardCycle;
    onClose?: () => void;
    busy: boolean;
  },
) {
  const dt = useDt();
  const c = entry.cycle;
  const kpi = sprintKpi(entry.items, entry.withdrawn);
  const live = c.status === "active";
  return (
    <div className="shrink-0 border-b border-line px-3 pb-2 pt-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-ink" style={{ fontSize: 14 }}>
          {c.name}
        </span>
        <span
          className={cn(
            "text-[12px]",
            live ? "text-accent-ink" : "text-ink-mute",
          )}
        >
          {live ? dt("· идёт", "· running") : dt("· запланирован", "· planned")}
        </span>
        {live && onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto h-7 shrink-0 rounded-[7px] border border-primary bg-surface px-2.5 font-semibold text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-50"
            style={{ fontSize: 12 }}
          >
            {dt("Закрыть спринт", "Close sprint")}
          </button>
        )}
      </div>
      <div className="mt-0.5 text-ink-mute" style={{ fontSize: 12 }}>
        {fmtRange(c.start_date, c.end_date)}
        {c.check_date && live
          ? ` · ${dt("сверка", "check")} ${fmtDay(c.check_date)}`
          : ""}
        {kpi.total > 0 && (
          <>
            {" · "}
            <ProgressText progress={kpi} />
          </>
        )}
      </div>
      {live && <ProgressBar percent={kpi.percent} className="mt-1.5" />}
    </div>
  );
}

/** Родитель и его подзадачи лесенкой: отступ и линия слева; «+ ещё N в С6» — про подзадачи в других спринтах. */
function Ladder(
  { cycle, ctx, inColumn, root, kids }: {
    cycle: SprintCycle;
    ctx: BoardCtx;
    inColumn: ReadonlySet<string>;
    root: SprintCycleItem;
    kids: SprintCycleItem[];
  },
) {
  const dt = useDt();
  const allKids = root.task_id ? ctx.kidsOf(root.task_id) : [];
  const elsewhere = kidsElsewhere(allKids, cycle.id, inColumn, ctx.cycles);
  return (
    <>
      <ItemCard item={root} cycle={cycle} ctx={ctx} inColumn={inColumn} />
      {(kids.length > 0 || elsewhere.length > 0) && (
        <div
          className="ml-3 flex flex-col gap-1.5 border-l-2 border-line pl-2"
          data-testid="ladder"
        >
          {kids.map((k) => (
            <ItemCard
              key={k.id}
              item={k}
              cycle={cycle}
              ctx={ctx}
              inColumn={inColumn}
            />
          ))}
          {elsewhere.length > 0 && (
            <div className="px-1 text-ink-mute" style={{ fontSize: 11.5 }}>
              {elsewhere.map((e) =>
                dt(`+ ещё ${e.n} в ${e.short}`, `+ ${e.n} more in ${e.short}`)
              ).join(" · ")}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Зона «Отвязать от «…»» внизу колонки: бросок сюда снимает родителя. */
export function UnlinkDrop({ zone, bg = "bg-surface-2" }: {
  zone: UnlinkZone;
  /** Сплошной фон колонки: под зоной содержимое не просвечивает. */
  bg?: string;
}) {
  const dt = useDt();
  return (
    <div
      className={cn(
        "sticky bottom-0 z-[2] mt-auto -mx-2 -mb-2 border-t border-line px-2 pb-2 pt-2",
        bg,
      )}
    >
      <div
        {...zone.handlers}
        data-testid="unlink-zone"
        className={cn(
          "rounded-[9px] border-2 border-dashed px-2 py-2 text-center",
          zone.over
            ? "border-primary bg-accent-soft text-accent-ink"
            : "border-line-2 bg-surface text-ink-soft",
        )}
        style={{ fontSize: 12.5 }}
      >
        {dt(
          `Отвязать от «${zone.parentTitle}»`,
          `Unlink from “${zone.parentTitle}”`,
        )}
      </div>
    </div>
  );
}

/** Колонка идущего или запланированного спринта. */
export function SprintColumn(
  { entry, ctx, drop, onCloseSprint, onAddTask, busy }: {
    entry: SprintBoardCycle;
    ctx: BoardCtx;
    drop: ColumnDrop;
    onCloseSprint?: (cycleId: string) => void;
    /** Завести задачу в этот спринт; groupId — группа (проект) или `null`, если без группы. */
    onAddTask?: (groupId: string | null) => void;
    busy: boolean;
  },
) {
  const dt = useDt();
  const c = entry.cycle;
  const visible = entry.items.filter((i) =>
    itemMatches(i, ctx.namesFor(i.task_id, i.assignees), ctx.filter)
  );
  const moved = entry.moved.filter((i) =>
    itemMatches(i, ctx.namesFor(i.task_id, i.assignees), ctx.filter)
  );
  const matches = new Set(visible.map((i) => i.id));
  const inColumn = new Set(
    entry.items.flatMap((
      i,
    ) => (i.task_id && !i.moved && !i.removed ? [i.task_id] : [])),
  );
  const parentOf = (taskId: string) =>
    ctx.planById.get(taskId)?.parent_id ?? null;
  const groups = groupItems(entry.items).map((g) => ({
    name: g.name,
    projectId: g.items[0]?.project_id ?? null,
    // Родитель остаётся, если подошла хотя бы одна подзадача: иначе найденная осталась бы без контекста.
    ladder: buildLadder(g.items, parentOf).map((n) => ({
      item: n.item,
      kids: n.kids.filter((k) => matches.has(k.id)),
      shown: matches.has(n.item.id) || n.kids.some((k) => matches.has(k.id)),
    })).filter((n) => n.shown),
  })).filter((g) => g.ladder.length > 0);
  const unlink = ctx.unlinkZone(c.id);
  const filtering = !!ctx.filter.query.trim() || !!ctx.filter.person ||
    ctx.filter.attention;
  // Клик по пустому месту колонки: группа — та, что в колонке единственная; иначе без группы.
  const emptyClickGroup = groups.length === 1 ? groups[0].projectId : null;
  return (
    <section
      {...drop.handlers}
      aria-label={c.name}
      className={cn(
        "flex h-full min-h-0 shrink-0 snap-start flex-col rounded-[12px] border",
        "w-[calc(100vw-3.5rem)] sm:w-[290px]",
        c.status === "active"
          ? "border-accent-line bg-accent-soft/40 lg:w-[380px]"
          : "border-line bg-surface-2",
        drop.valid &&
          "outline-2 -outline-offset-2 outline-dashed outline-primary/40",
        drop.over && "bg-accent-soft outline-primary",
      )}
    >
      <CycleHeader
        entry={entry}
        onClose={onCloseSprint ? () => onCloseSprint(c.id) : undefined}
        busy={busy}
      />
      <div
        data-board-scroll
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
        onClick={onAddTask
          ? (e) => {
            if (isEmptyAreaClick(e)) onAddTask(emptyClickGroup);
          }
          : undefined}
      >
        {groups.map((g) => (
          <div key={g.name ?? "__none"} className="flex flex-col gap-1.5">
            <div
              className="mx-1 mt-1.5 flex items-center justify-between gap-2 font-semibold uppercase tracking-[0.04em] text-ink-mute"
              style={{ fontSize: 11 }}
            >
              <span className="min-w-0 truncate">
                {g.name ?? dt("Без группы", "No group")}
              </span>
              {onAddTask && (
                <AddTaskChip onClick={() => onAddTask(g.projectId)} />
              )}
            </div>
            {g.ladder.map(({ item, kids }) => (
              <Ladder
                key={item.id}
                cycle={c}
                ctx={ctx}
                inColumn={inColumn}
                root={item}
                kids={kids}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 && moved.length === 0 && (
          <p
            className="px-2 py-4 text-center text-ink-mute"
            style={{ fontSize: 12.5 }}
          >
            {filtering
              ? dt("Под фильтр ничего не подошло", "Nothing matches the filter")
              : dt(
                "Пока пусто — возьмите задачи из мастер-плана",
                "Empty so far — take tasks from the master plan",
              )}
            {!filtering && onAddTask && (
              <>
                {dt(" или ", " or ")}
                <button
                  type="button"
                  onClick={() => onAddTask(null)}
                  className="font-medium text-accent-ink underline-offset-2 hover:underline"
                >
                  {dt("добавьте новую", "add a new one")}
                </button>
              </>
            )}
          </p>
        )}
        <MovedSection
          items={moved}
          users={ctx.users}
          onAddReason={(item) => ctx.addReason(c.id, item)}
          single
        />
        {onAddTask && (
          <AddTaskChip
            className="mx-1 mb-1 self-start"
            onClick={() => onAddTask(emptyClickGroup)}
          />
        )}
        {unlink && <UnlinkDrop zone={unlink} />}
      </div>
    </section>
  );
}

/** Состав принятого спринта по запросу: только чтение, снимок на момент приёмки. */
export function PastBody(
  { cycle, ctx }: { cycle: SprintCycle; ctx: BoardCtx },
) {
  const dt = useDt();
  const [detail, setDetail] = useState<SprintCycleDetail | "error" | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    fetchSprintCycle(cycle.id).then((d) => alive && setDetail(d)).catch(() =>
      alive && setDetail("error")
    );
    return () => {
      alive = false;
    };
  }, [cycle.id]);
  if (detail === null) {
    return (
      <p className="p-3 text-ink-mute" style={{ fontSize: 12.5 }}>
        {dt("Загрузка…", "Loading…")}
      </p>
    );
  }
  if (detail === "error") {
    return (
      <p className="p-3 text-pri-high" style={{ fontSize: 12.5 }}>
        {dt("Не удалось загрузить состав", "Could not load the tasks")}
      </p>
    );
  }
  const visible = detail.items.filter((i) =>
    itemMatches(i, i.assignees, ctx.filter)
  );
  const moved = (detail.moved ?? []).filter((i) =>
    itemMatches(i, i.assignees, ctx.filter)
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
      {visible.map((i) => (
        <div
          key={i.id}
          className="rounded-[9px] border border-dashed border-line-2 bg-surface-2/60 px-2.5 py-1.5"
          style={{ fontSize: 12.5 }}
        >
          <span
            className={cn(
              "font-semibold uppercase tracking-[0.03em]",
              isClosedStatus(i.status) ? "text-status-done" : "text-pri-med",
            )}
            style={{ fontSize: 10.5 }}
          >
            {isClosedStatus(i.status)
              ? dt("сделана", "done")
              : dt("не завершена", "unfinished")}
          </span>
          <div className="whitespace-normal break-words text-ink">
            {i.title}
          </div>
          {!isClosedStatus(i.status) && i.carry_reason && (
            <div className="text-ink-mute">
              {dt("Причина", "Reason")}: «{i.carry_reason}»
            </div>
          )}
        </div>
      ))}
      <MovedSection items={moved} users={ctx.users} single />
      {visible.length === 0 && moved.length === 0 && (
        <p
          className="px-2 py-3 text-center text-ink-mute"
          style={{ fontSize: 12.5 }}
        >
          {dt("Ничего не найдено", "Nothing found")}
        </p>
      )}
    </div>
  );
}
