"use client";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { SprintCycleItem } from "@/types";
import { setSprintMovedReason } from "@/lib/api";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { PILL_BTN } from "./atoms";

// Маленькое окно «вписать причину» для снимка без причины: задачу увезла автоматика (сменили
// срок в карточке), и причину спрашиваем один раз — здесь. Записанную сервер не переписывает.

export function ReasonDialog(
  { item, cycleId, onClose, onDone }: {
    /** Снимок без причины; null — окно закрыто. */
    item: SprintCycleItem | null;
    cycleId: string;
    onClose: () => void;
    onDone: () => void | Promise<void>;
  },
) {
  const dt = useDt();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setReason("");
    setErr(null);
    setBusy(false);
  }, [item]);

  if (!item) return null;

  async function submit() {
    if (!item || !reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await setSprintMovedReason(cycleId, item.id, reason.trim());
      await onDone();
      onClose();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Причина не сохранилась", "The reason was not saved"),
      );
      setBusy(false);
    }
  }

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="moved-reason-title"
          className="fixed top-1/2 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="moved-reason-title"
            className="font-heading text-[16px] font-bold text-ink"
          >
            {dt(
              "Почему задача ушла из спринта?",
              "Why did the task leave the sprint?",
            )}
          </DialogPrimitive.Title>
          <p className="-mt-2 truncate text-[12.5px] text-ink-mute">
            «{item.title}»
          </p>
          <textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={dt("Причина переноса", "Reason for the move")}
            placeholder={dt(
              "Например: перенесли срок по просьбе заказчика",
              "For example: the client moved the deadline",
            )}
            className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent-line"
          />
          {err && <p className="text-[12.5px] text-pri-high">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={PILL_BTN}
            >
              {dt("Отмена", "Cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!reason.trim() || busy}
              className={cn(
                PILL_BTN,
                "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
              )}
            >
              {dt("Сохранить", "Save")}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
