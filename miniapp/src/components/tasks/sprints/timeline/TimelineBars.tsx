"use client";
import { useMemo } from "react";
import type { MoveMark, TaskRowModel, TimelineCol } from "@/lib/sprintTimeline";
import { cn } from "@/lib/utils";
import { BAR_STYLE, MOVE_STYLE } from "./timelineStyle";

/** Ширина чипа «перенос» в пикселях: он прижат к правому краю столбца, откуда задача ушла. */
const MOVE_W = 86;
const GAP = 2;

type Seg = { from: number; to: number; past: boolean };

/** Подряд идущие столбцы задачи — один отрезок; на границе «прошлое / остальное» режем, чтобы прошлое выцвело. */
function segments(cols: readonly number[], all: readonly TimelineCol[]): Seg[] {
  const out: Seg[] = [];
  for (const c of cols) {
    const past = all[c].kind === "past";
    const last = out[out.length - 1];
    if (last && last.to === c - 1 && last.past === past) {
      out[out.length - 1] = { ...last, to: c };
    } else out.push({ from: c, to: c, past });
  }
  return out;
}

export type MoveHover = (
  mark: MoveMark | null,
  el: HTMLElement | null,
  row: TaskRowModel,
) => void;

/** Правая часть строки задачи: отрезки через спринты и чипы переноса со стрелкой. */
export function TaskTrack({ row, cols, dt, onOpen, onHover }: {
  row: TaskRowModel;
  cols: readonly TimelineCol[];
  dt: (ru: string, en: string) => string;
  onOpen: (taskId: string) => void;
  onHover: MoveHover;
}) {
  const segs = useMemo(() => segments(row.cols, cols), [row.cols, cols]);
  // Подпись — на последнем непрошлом отрезке (там ширина), иначе на последнем.
  const labelSeg = [...segs].reverse().find((s) => !s.past) ??
    segs[segs.length - 1];
  const style = BAR_STYLE[row.state];
  return (
    <>
      {segs.map((s, i) => {
        const a = cols[s.from];
        const b = cols[s.to];
        const joinsPrev = i > 0 && segs[i - 1].to === s.from - 1;
        const joinsNext = i < segs.length - 1 && segs[i + 1].from === s.to + 1;
        const withLabel = s === labelSeg;
        return (
          <button
            key={s.from}
            type="button"
            onClick={() => onOpen(row.task.id)}
            title={row.task.title}
            className={cn(
              "absolute top-[3px] flex h-[22px] items-center gap-1.5 overflow-hidden whitespace-nowrap border px-2 text-ink",
              "transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              joinsPrev ? "rounded-l-none border-l-0" : "rounded-l-[5px]",
              joinsNext ? "rounded-r-none border-r-0" : "rounded-r-[5px]",
              s.past && "opacity-55",
            )}
            style={{
              ...style,
              fontSize: 12,
              left: `calc(${a.left}% + ${joinsPrev ? 0 : GAP}px)`,
              width: `calc(${b.left + b.width - a.left}% - ${
                (joinsPrev ? 0 : GAP) + (joinsNext ? 0 : GAP)
              }px)`,
            }}
          >
            {withLabel && (
              <>
                <span className="truncate">{row.task.title}</span>
                {row.task.moves > 0 && (
                  <span
                    className="shrink-0 rounded border border-line-2 px-1 font-mono text-ink-soft"
                    style={{ fontSize: 10.5 }}
                    title={dt(
                      "Переносилась между спринтами",
                      "Moved between sprints",
                    )}
                  >
                    ↪{row.task.moves}
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}
      {row.moves.map((m) => {
        const from = cols[m.from];
        const to = m.to === null ? null : cols[m.to];
        const noReason = m.snapshot.moved?.reason === null;
        const edge = from.left + from.width;
        return (
          <span key={m.snapshot.id}>
            {to && to.left > edge + 0.01 && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-[13px] border-t border-dashed"
                style={{
                  left: `${edge}%`,
                  width: `${to.left - edge}%`,
                  borderColor: noReason ? "var(--chart-5)" : "var(--chart-4)",
                }}
              />
            )}
            <button
              type="button"
              onMouseEnter={(e) => onHover(m, e.currentTarget, row)}
              onMouseLeave={() => onHover(null, null, row)}
              onFocus={(e) => onHover(m, e.currentTarget, row)}
              onBlur={() => onHover(null, null, row)}
              onClick={() => onOpen(row.task.id)}
              aria-label={dt(
                "Перенос: причина во всплывающей подсказке",
                "Move: reason in the tooltip",
              )}
              className="absolute top-[4px] z-[2] flex h-5 items-center justify-center whitespace-nowrap rounded-[5px] border border-dashed font-medium"
              style={{
                ...MOVE_STYLE(noReason),
                fontSize: 10.5,
                left: `calc(${edge}% - ${MOVE_W + GAP}px)`,
                width: MOVE_W,
              }}
            >
              {noReason
                ? dt("без причины", "no reason")
                : dt("перенос", "moved")} ▸
            </button>
          </span>
        );
      })}
    </>
  );
}
