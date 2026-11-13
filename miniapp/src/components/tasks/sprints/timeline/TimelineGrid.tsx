"use client";
import {
  colPos,
  dayFraction,
  dayNum,
  type GroupModel,
  type TimelineCol,
} from "@/lib/sprintTimeline";
import { cn } from "@/lib/utils";
import { fmtDay } from "../format";
import { type MoveHover, TaskTrack } from "./TimelineBars";
import { COL_STYLE, STATE_DOT } from "./timelineStyle";

export const LEFT_W = 300;
/** Минимальная ширина всей ленты: уже неё включается горизонтальная прокрутка. */
export const MIN_W = 1160;
const ROW_H = 28;

type Dt = (ru: string, en: string) => string;

/** Подложка правой части: полосы столбцов и линии «сегодня» / «сверка» на всю высоту ленты. */
export function Backdrop(
  { cols, today }: { cols: readonly TimelineCol[]; today: string },
) {
  const cur = cols.find((c) => c.kind === "current");
  const tf = cur ? dayFraction(cur.cycle, today) : null;
  const cf = cur?.cycle.check_date
    ? dayFraction(cur.cycle, cur.cycle.check_date)
    : null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 z-0"
      style={{ left: LEFT_W, right: 0 }}
    >
      {cols.map((c) => (
        <div
          key={c.cycle.id}
          className="absolute inset-y-0 border-r border-line"
          style={{
            ...COL_STYLE[c.kind],
            left: `${c.left}%`,
            width: `${c.width}%`,
          }}
        />
      ))}
      {cur && cf !== null && (
        <div
          className="absolute inset-y-0 border-l border-dashed"
          style={{
            left: `${colPos(cur, cf)}%`,
            borderColor: "var(--chart-4)",
            opacity: 0.8,
          }}
        />
      )}
      {cur && tf !== null && (
        <div
          className="absolute inset-y-0 border-l-[1.5px] border-primary"
          style={{
            left: `${colPos(cur, tf)}%`,
            boxShadow:
              "0 0 8px color-mix(in srgb, var(--primary) 45%, transparent)",
          }}
        />
      )}
    </div>
  );
}

function ColHead(
  { col, today, dt }: { col: TimelineCol; today: string; dt: Dt },
) {
  const { cycle, kind } = col;
  const stats = cycle.stats;
  const sub = kind === "past"
    ? stats
      ? dt(
        `принят ${stats.planDone}/${stats.plan}`,
        `accepted ${stats.planDone}/${stats.plan}`,
      )
      : dt("принят", "accepted")
    : kind === "current"
    ? `${fmtDay(cycle.start_date)} — ${fmtDay(cycle.end_date)}`
    : dt(`план ${col.items.length} задач`, `plan: ${col.items.length} tasks`);
  const start = dayNum(cycle.start_date);
  const days = dayNum(cycle.end_date) - start + 1;
  const checkDay = cycle.check_date ? dayNum(cycle.check_date) : null;
  return (
    <div
      className="absolute inset-y-0 px-2.5 pt-2"
      style={{ left: `${col.left}%`, width: `${col.width}%` }}
    >
      <div
        className={cn(
          "truncate font-semibold",
          kind === "past" ? "text-ink-soft" : "text-ink",
        )}
        style={{ fontSize: 13 }}
      >
        {cycle.name}
        {kind === "current" && (
          <span
            className="ml-1.5 rounded border border-accent-line bg-accent-soft px-1.5 align-middle font-medium text-accent-ink"
            style={{ fontSize: 10.5 }}
          >
            {dt("идёт", "active")}
          </span>
        )}
      </div>
      <div className="truncate text-ink-mute" style={{ fontSize: 11.5 }}>
        {sub}
      </div>
      {kind === "current" && days > 0 && days <= 31 && (
        <div
          className="absolute inset-x-0 bottom-0.5 flex px-0 font-mono"
          style={{ fontSize: 9.5 }}
        >
          {Array.from({ length: days }, (_, i) => {
            const n = start + i;
            const d = new Date(n * 86_400_000);
            const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
            const isToday = n === dayNum(today);
            return (
              <i
                key={n}
                className={cn(
                  "flex-1 rounded-[3px] text-center not-italic",
                  isToday
                    ? "bg-primary font-semibold text-primary-foreground"
                    : weekend
                    ? "text-ink-mute/50"
                    : "text-ink-mute",
                  n === checkDay && !isToday &&
                    "outline outline-1 outline-[color:var(--chart-4)]",
                )}
              >
                {d.getUTCDate()}
              </i>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TimelineHead({ cols, today, dt, groupsLabel, tasksLabel }: {
  cols: readonly TimelineCol[];
  today: string;
  dt: Dt;
  groupsLabel: string;
  tasksLabel: string;
}) {
  return (
    <div className="sticky top-0 z-30 flex h-[66px] border-b border-line-2 bg-surface">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line-2 bg-surface px-3.5 text-ink-mute"
        style={{ width: LEFT_W, fontSize: 12 }}
      >
        <b className="font-semibold text-ink" style={{ fontSize: 13 }}>
          {groupsLabel}
        </b>
        <span className="ml-auto">{tasksLabel}</span>
      </div>
      <div className="relative flex-1">
        {cols.map((c) => (
          <ColHead key={c.cycle.id} col={c} today={today} dt={dt} />
        ))}
      </div>
    </div>
  );
}

function Squares(
  { n, done, past }: { n: number; done: number; past: boolean },
) {
  const shown = Math.min(n, 8);
  return (
    <span className={cn("flex items-center gap-[3px]", past && "opacity-50")}>
      <em
        className="mr-1 font-mono not-italic text-ink-soft"
        style={{ fontSize: 11 }}
      >
        {n}
      </em>
      {Array.from({ length: shown }, (_, i) => (
        <i
          key={i}
          className="block h-[9px] w-[9px] rounded-[2px] border"
          style={{
            background: i < Math.round((done / n) * shown)
              ? "var(--chart-3)"
              : "transparent",
            borderColor: i < Math.round((done / n) * shown)
              ? "var(--chart-3)"
              : "var(--line-2)",
          }}
        />
      ))}
    </span>
  );
}

export function GroupBlock(
  { group, cols, open, onToggle, dt, onOpen, onHover, indexOfParent }: {
    group: GroupModel;
    cols: readonly TimelineCol[];
    open: boolean;
    onToggle: () => void;
    dt: Dt;
    onOpen: (taskId: string) => void;
    onHover: MoveHover;
    indexOfParent: ReadonlySet<string>;
  },
) {
  const done = group.rows.filter((r) => r.task.status === "done").length;
  const pct = Math.round((done / group.rows.length) * 100);
  return (
    <div className="border-b border-line">
      <div className="relative z-[1] flex" style={{ height: 40 }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="sticky left-0 z-10 flex shrink-0 gap-2 border-r border-line-2 bg-surface px-3 pt-1.5 text-left hover:bg-surface-2"
          style={{ width: LEFT_W }}
        >
          <span
            className="mt-[3px] w-2.5 text-ink-mute"
            style={{ fontSize: 10 }}
          >
            {open ? "▾" : "▸"}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate font-semibold text-ink"
              style={{ fontSize: 13 }}
            >
              {group.name}
            </span>
            <span
              className="flex items-center gap-2 text-ink-mute"
              style={{ fontSize: 11 }}
            >
              <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-2">
                <i
                  className="block h-full"
                  style={{ width: `${pct}%`, background: "var(--chart-3)" }}
                />
              </span>
              <span className="font-mono">{done}/{group.rows.length}</span>
              {group.hidden > 0 && (
                <span>
                  {dt(
                    `+${group.hidden} вне ленты`,
                    `+${group.hidden} off the timeline`,
                  )}
                </span>
              )}
            </span>
          </span>
        </button>
        <div className="relative flex-1">
          {cols.map((c, i) => {
            const mine = group.rows.filter((r) => r.cols.includes(i));
            if (mine.length === 0) return null;
            return (
              <div
                key={c.cycle.id}
                className="absolute top-2.5 px-2.5"
                style={{ left: `${c.left}%` }}
              >
                <Squares
                  n={mine.length}
                  done={mine.filter((r) => r.task.status === "done").length}
                  past={c.kind === "past"}
                />
              </div>
            );
          })}
        </div>
      </div>
      {open &&
        group.rows.map((r) => (
          <div
            key={r.task.id}
            className="relative z-[1] flex"
            style={{ height: ROW_H }}
          >
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line-2 bg-surface py-0 pr-2 text-ink-soft"
              style={{
                width: LEFT_W,
                paddingLeft:
                  r.task.parent_id && indexOfParent.has(r.task.parent_id)
                    ? 44
                    : 32,
                fontSize: 11.5,
              }}
            >
              <i
                className="block h-2 w-2 shrink-0 rounded-full"
                style={{ background: STATE_DOT[r.state] }}
              />
              <span
                className="min-w-0 flex-1 truncate text-ink"
                title={r.task.title}
              >
                {r.task.title}
              </span>
              <span className="shrink-0 text-ink-mute" style={{ fontSize: 11 }}>
                {r.task.assignees[0] ?? ""}
              </span>
            </div>
            <div className="relative flex-1">
              <TaskTrack
                row={r}
                cols={cols}
                dt={dt}
                onOpen={onOpen}
                onHover={onHover}
              />
            </div>
          </div>
        ))}
    </div>
  );
}
