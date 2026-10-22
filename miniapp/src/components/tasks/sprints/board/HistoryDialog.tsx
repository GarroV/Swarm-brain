"use client";
import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { SprintCycle } from "@/types";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { PILL_BTN } from "../atoms";
import { fmtDay, fmtRange } from "../format";
import type { BoardCtx } from "./boardCtx";
import { PastBody } from "./BoardColumn";

// «История спринтов» (спека, «Доска»): принятые спринты пространства с замороженными итогами —
// сделано, перенесено — и раскрытием состава со снимками. Итоги закрытых до раскатки переносов
// не пересчитываются (`stats` заморожены), поэтому «перенесено» берётся из того, что записано.

export function HistoryDialog({ open, cycles, ctx, onClose }: {
  open: boolean;
  cycles: readonly SprintCycle[];
  ctx: BoardCtx;
  onClose: () => void;
}) {
  const dt = useDt();
  const [openId, setOpenId] = useState<string | null>(null);
  const past = cycles.filter((c) => c.status === "accepted").sort((a, b) =>
    b.start_date.localeCompare(a.start_date)
  );
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="sprint-history-title"
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="sprint-history-title"
            className="font-heading text-[16px] font-bold text-ink"
          >
            {dt("История спринтов", "Sprint history")}
          </DialogPrimitive.Title>
          {past.length === 0
            ? (
              <p className="rounded-[8px] border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft">
                {dt(
                  "Принятых спринтов в этом пространстве пока нет.",
                  "No accepted sprints in this space yet.",
                )}
              </p>
            )
            : (
              <ul className="flex flex-col gap-1.5">
                {past.map((c) => {
                  const on = openId === c.id;
                  const s = c.stats;
                  const moved = s ? s.moved ?? s.carried : null;
                  return (
                    <li
                      key={c.id}
                      className="rounded-[10px] border border-line"
                    >
                      <button
                        type="button"
                        aria-expanded={on}
                        onClick={() => setOpenId(on ? null : c.id)}
                        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-left"
                      >
                        <span
                          className="font-semibold text-ink"
                          style={{ fontSize: 13.5 }}
                        >
                          {c.name}
                        </span>
                        <span
                          className="text-ink-mute"
                          style={{ fontSize: 12 }}
                        >
                          {fmtRange(c.start_date, c.end_date)}
                          {c.accepted_at
                            ? ` · ${dt("закрыт", "closed")} ${
                              fmtDay(c.accepted_at)
                            }`
                            : ""}
                        </span>
                        {s && (
                          <span
                            className="ml-auto text-ink-soft"
                            style={{ fontSize: 12 }}
                          >
                            {dt("сделано", "done")} {s.planDone}{" "}
                            {dt("из", "of")} {s.plan}
                            {moved !== null && moved > 0
                              ? ` · ${dt("перенесено", "moved")} ${moved}`
                              : ""}
                          </span>
                        )}
                      </button>
                      {on && (
                        <div
                          className={cn(
                            "flex max-h-[320px] flex-col border-t border-line",
                          )}
                        >
                          <PastBody cycle={c} ctx={ctx} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={PILL_BTN}>
              {dt("Закрыть", "Close")}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
