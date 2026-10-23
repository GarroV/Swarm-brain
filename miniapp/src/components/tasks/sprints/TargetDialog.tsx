"use client";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { SprintCycle } from "@/types";
import { cycleDates, cycleShort, dueCycleOf } from "@/lib/sprintLabels";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { PILL_BTN } from "./atoms";

// Компактный выбор спринта для «Взять в спринт…» и «Переставить…» (владелец 22.10.2026: в меню
// «⋯» — никаких пунктов на каждый спринт). Без причины: это планирование, а не срыв. Плитки
// «С5 · 03.11–16.11», 🏁 у спринта срока задачи; клик по плитке — сразу действие.

export function TargetDialog(
  { mode, title, due, cycles, onPick, onClose }: {
    /** `null` — окно закрыто. */
    mode: "take" | "shift" | null;
    title: string;
    /** Срок задачи: спринт срока помечается флажком. */
    due: string | null;
    /** Спринты, куда можно положить задачу, по порядку. */
    cycles: readonly SprintCycle[];
    onPick: (target: SprintCycle) => void;
    onClose: () => void;
  },
) {
  const dt = useDt();
  if (!mode) return null;
  const flag = dueCycleOf(cycles, due)?.id;
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="target-title"
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="target-title"
            className="font-heading text-[16px] font-bold text-ink"
          >
            {mode === "take"
              ? dt("Взять в спринт", "Take into a sprint")
              : dt("Переставить в спринт", "Shift to a sprint")}
          </DialogPrimitive.Title>
          <p className="-mt-2 truncate text-[12.5px] text-ink-mute">
            «{title}»
          </p>
          {cycles.length === 0
            ? (
              <p className="rounded-[8px] border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft">
                {dt(
                  "Подходящих спринтов нет — сначала заведите следующий.",
                  "There is no suitable sprint — create the next one first.",
                )}
              </p>
            )
            : (
              <div className="flex flex-wrap gap-1.5">
                {cycles.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.name}
                    onClick={() => onPick(c)}
                    className={cn(
                      "rounded-[8px] border border-line px-2.5 py-1 text-left text-[12.5px] font-medium text-ink-soft hover:border-primary/50 hover:text-ink",
                      c.status === "active" && "border-primary/40",
                    )}
                  >
                    {c.id === flag ? "🏁 " : ""}
                    {cycleShort(c.name)}
                    <span className="ml-1.5 font-mono text-[11px] opacity-70">
                      {cycleDates(c)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={PILL_BTN}>
              {dt("Отмена", "Cancel")}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
