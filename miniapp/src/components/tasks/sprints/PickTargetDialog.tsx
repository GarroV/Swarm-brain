"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { type HoverMode, subtaskBlock } from "@/lib/sprintGrouping";
import type { DropTarget } from "@/lib/sprintGrouping";
import { useDt } from "@/components/roy/nav";
import type { RowInfo } from "./useRowDrag";
import { blockText } from "./groupingText";

// Запасной путь к тому же, что делает перетаскивание: с клавиатуры и для того, кому тащить
// неудобно. Основной путь — жест (на таче тоже: долгое нажатие и тащить). Выбор цели отдаёт
// тот же бросок, что и жест, поэтому правила одни — lib/sprintGrouping.ts.

export function PickTargetDialog(
  { open, row, rows, onCancel, onPick }: {
    open: boolean;
    row: RowInfo | null;
    rows: RowInfo[];
    onCancel: () => void;
    onPick: (target: DropTarget, mode: HoverMode) => void;
  },
) {
  const dt = useDt();
  const [mode, setMode] = useState<HoverMode>("group");
  // Выбрали цель — следом может открыться окно названия группы. Возврат фокуса на «⋯» после
  // закрытия этого окна уводил его из поля названия (замерено: печать шла мимо поля).
  const picked = useRef(false);
  useEffect(() => {
    if (open) {
      setMode("group");
      picked.current = false;
    }
  }, [open]);
  if (!row) return null;

  const candidates = rows.filter((r) =>
    r.taskId !== row.taskId && (mode === "subtask" || !r.isSubtask)
  );

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="pick-target-title"
          finalFocus={() => !picked.current}
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[80vh] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="pick-target-title"
            className="truncate font-heading text-[16px] font-bold text-ink"
          >
            «{row.title}»
          </DialogPrimitive.Title>
          <div className="mt-3 flex gap-1.5" role="tablist">
            {([
              ["group", dt("Сгруппировать с…", "Group with…")],
              ["subtask", dt("Сделать подзадачей…", "Make a subtask of…")],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-[8px] border px-2.5 py-1 text-[12.5px] font-medium",
                  mode === m
                    ? "border-primary/50 bg-primary/12 text-primary"
                    : "border-line text-ink-soft hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {candidates.map((r) => {
              const target = {
                kind: "task" as const,
                taskId: r.taskId,
                projectId: r.projectId,
                isSubtask: r.isSubtask,
              };
              const block = mode === "subtask"
                ? subtaskBlock(row, target)
                : null;
              return (
                <li key={r.taskId}>
                  <button
                    type="button"
                    disabled={block !== null}
                    onClick={() => {
                      picked.current = true;
                      onPick(target, mode);
                    }}
                    className="w-full rounded-[8px] border border-line px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block truncate">{r.title}</span>
                    {block && (
                      <span className="block truncate text-[11.5px] text-ink-mute">
                        {blockText(dt, block, r.title)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
