"use client";
import { createPortal } from "react-dom";
import type { MoveMark, TaskRowModel, TimelineCol } from "@/lib/sprintTimeline";
import { fmtDay } from "../format";

export type TipState = { mark: MoveMark; row: TaskRowModel; rect: DOMRect };

const TIP_W = 290;

/** Подсказка переноса: откуда и куда, причина, кто и когда. Появляется на наведении чипа. */
export function MoveTip({ tip, cols, userName, dt }: {
  tip: TipState;
  cols: readonly TimelineCol[];
  userName: (telegramId: number | null) => string | null;
  dt: (ru: string, en: string) => string;
}) {
  if (typeof document === "undefined") return null;
  const m = tip.mark.snapshot.moved;
  if (!m) return null;
  const from = cols[tip.mark.from].cycle.name;
  const to = m.to_cycle_name ?? dt("спринт удалён", "sprint deleted");
  const by = m.by === null
    ? dt("автоматически, сменили срок", "automatically, due date changed")
    : (userName(m.by) ?? dt("участник", "member"));
  const left = Math.max(
    8,
    Math.min(tip.rect.left, globalThis.innerWidth - TIP_W - 8),
  );
  const below = tip.rect.bottom + 6 + 150 < globalThis.innerHeight;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[200] rounded-[9px] border border-primary bg-popover px-3 py-2.5 text-popover-foreground shadow-xl"
      style={{
        width: TIP_W,
        left,
        top: below ? tip.rect.bottom + 6 : undefined,
        bottom: below ? undefined : globalThis.innerHeight - tip.rect.top + 6,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <b className="block" style={{ fontSize: 12.5 }}>{tip.row.task.title}</b>
      <span className="block text-ink-mute">
        {dt(
          `перенос из «${from}» в «${to}»`,
          `moved from “${from}” to “${to}”`,
        )}
      </span>
      <div className="mt-1.5">
        <span className="text-ink-mute">{dt("Причина: ", "Reason: ")}</span>
        {m.reason ?? (
          <i style={{ color: "var(--chart-5)" }}>
            {dt("не указана", "not given")}
          </i>
        )}
      </div>
      <div className="mt-1 text-ink-mute">
        {by} · {fmtDay(m.at)}
        {m.due_now ? ` · ${dt("срок", "due")} ${fmtDay(m.due_now)}` : ""}
      </div>
    </div>,
    document.body,
  );
}
