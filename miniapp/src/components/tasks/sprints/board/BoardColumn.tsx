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
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { ProgressBar, ProgressText } from "../atoms";
import { fmtDay, fmtRange } from "../format";
import { MovedSection } from "../SnapshotCard";
import { BoardCard, Tag } from "./BoardCard";
import type { BoardCtx } from "./boardCtx";
import {
  dueCycle,
  groupItems,
  isClosedStatus,
  itemMatches,
} from "./boardModel";
import { TaskMenu } from "./TaskMenu";

// Колонка спринта на доске: идущий — шире и с прогрессом, запланированные — обычные, принятые —
// свёрнутая полоска ~46px, которую раскрывает клик (владелец: «сокращался в полоску, и можно было
// развернуть»). Состав принятого спринта приходит по запросу — на доске он не лежит.

export const PAST_STRIP_W = 46;

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
  { item, cycle, ctx }: {
    item: SprintCycleItem;
    cycle: SprintCycle;
    ctx: BoardCtx;
  },
) {
  const dt = useDt();
  const plan = item.task_id ? ctx.planById.get(item.task_id) : undefined;
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

/** Колонка идущего или запланированного спринта. */
export function SprintColumn({ entry, ctx, drop, onCloseSprint, busy }: {
  entry: SprintBoardCycle;
  ctx: BoardCtx;
  drop: ColumnDrop;
  onCloseSprint?: (cycleId: string) => void;
  busy: boolean;
}) {
  const dt = useDt();
  const c = entry.cycle;
  const visible = entry.items.filter((i) =>
    itemMatches(i, ctx.namesFor(i.task_id, i.assignees), ctx.filter)
  );
  const moved = entry.moved.filter((i) =>
    itemMatches(i, ctx.namesFor(i.task_id, i.assignees), ctx.filter)
  );
  const groups = groupItems(visible);
  const filtering = !!ctx.filter.query.trim() || !!ctx.filter.person ||
    ctx.filter.attention;
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
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.name ?? "__none"} className="flex flex-col gap-1.5">
            <div
              className="mx-1 mt-1.5 font-semibold uppercase tracking-[0.04em] text-ink-mute"
              style={{ fontSize: 11 }}
            >
              {g.name ?? dt("Без группы", "No group")}
            </div>
            {g.items.map((i) => (
              <ItemCard key={i.id} item={i} cycle={c} ctx={ctx} />
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
          </p>
        )}
        <MovedSection
          items={moved}
          users={ctx.users}
          onAddReason={(item) => ctx.addReason(c.id, item)}
          single
        />
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

/** Принятый спринт: полоска ~46px; клик раскрывает, кнопка в шапке сворачивает. */
export function PastColumn({ entry, ctx, open, onToggle }: {
  entry: SprintBoardCycle;
  ctx: BoardCtx;
  open: boolean;
  onToggle: () => void;
}) {
  const dt = useDt();
  const c = entry.cycle;
  const done = c.stats
    ? `${c.stats.planDone} ${dt("из", "of")} ${c.stats.plan}`
    : null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label={`${c.name}: ${dt("развернуть", "expand")}`}
        data-testid="past-strip"
        style={{ width: PAST_STRIP_W }}
        className="flex h-full shrink-0 snap-start items-center justify-center rounded-[12px] border border-line bg-surface-2 text-ink-soft transition-colors hover:bg-surface hover:text-ink"
      >
        <span
          className="rotate-180 whitespace-nowrap font-semibold [writing-mode:vertical-rl]"
          style={{ fontSize: 12.5 }}
        >
          {c.name} · {dt("закрыт", "closed")}
          {done ? ` · ${done}` : ""}
        </span>
      </button>
    );
  }
  return (
    <section
      aria-label={c.name}
      className="flex h-full min-h-0 w-[calc(100vw-3.5rem)] shrink-0 snap-start flex-col rounded-[12px] border border-line bg-surface-2 sm:w-[290px]"
    >
      <div className="shrink-0 border-b border-line px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink" style={{ fontSize: 14 }}>
            {c.name}
          </span>
          <span className="text-[12px] text-ink-mute">
            · {dt("закрыт", "closed")}
            {c.accepted_at ? ` ${fmtDay(c.accepted_at)}` : ""}
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            className="ml-auto rounded-[7px] px-2 py-1 text-ink-soft hover:bg-surface hover:text-ink"
            style={{ fontSize: 12 }}
          >
            {dt("Свернуть", "Collapse")}
          </button>
        </div>
        <div className="mt-0.5 text-ink-mute" style={{ fontSize: 12 }}>
          {fmtRange(c.start_date, c.end_date)}
          {done ? ` · ${dt("сделано", "done")} ${done}` : ""}
        </div>
      </div>
      <PastBody cycle={c} ctx={ctx} />
    </section>
  );
}
