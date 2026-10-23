"use client";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { SprintCycle, SprintCycleItem } from "@/types";
import { moveSprintTask } from "@/lib/api";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { cycleDates, cycleShort, dueCycleOf } from "@/lib/sprintLabels";
import { fmtDayShort } from "./format";
import { PILL_BTN } from "./atoms";

// Окно переноса (решение владельца 22.10.2026, docs/superpowers/specs/2026-10-22-sprint-board-design.md
// §«Перенос»): задача из идущего спринта сразу уезжает в выбранный запланированный, в идущем
// остаётся снимок с причиной. Причину спрашиваем здесь и только здесь — один раз.
//
// Срок задачи меняет только дата, оставленная в этом окне: по умолчанию подставлен последний
// день цели, если старый срок цель срывает; стёрли поле — срок остаётся прежним (просроченным).
// Окно переиспользует доска спринтов (этап 3), поэтому вызов сервера — внутри.

/** Срок сорван: уже прошёл или наступает раньше начала спринта-цели. */
export function dueBroken(
  due: string | null,
  target: Pick<SprintCycle, "start_date">,
  today: string,
): boolean {
  if (!due) return false;
  return due < today || due < target.start_date;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function MoveDialog(
  { item, cycleId, cycles, kids = [], initialTargetId, onClose, onDone }: {
    /** Строка идущего спринта; null — окно закрыто. */
    item: SprintCycleItem | null;
    /** Спринт, из которого переносим. */
    cycleId: string;
    /** Запланированные спринты пространства — возможные цели, по порядку. */
    cycles: SprintCycle[];
    /** Незакрытые подзадачи этой задачи в том же спринте: едут вместе, если оставить галочку. */
    kids?: SprintCycleItem[];
    /** Цель, выбранная броском карточки: окно открывается сразу на ней. */
    initialTargetId?: string | null;
    onClose: () => void;
    /** Перенос прошёл — перечитать состав. */
    onDone: () => void | Promise<void>;
  },
) {
  const dt = useDt();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [newDue, setNewDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [withKids, setWithKids] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const target = cycles.find((c) => c.id === targetId) ?? null;
  const due = item?.due_date ?? null;
  const flagId = dueCycleOf(cycles, due)?.id;
  const broken = !!target && dueBroken(due, target, todayIso());

  // Каждое открытие — с чистого листа: ближайший запланированный спринт, пустая причина.
  useEffect(() => {
    if (!item) return;
    setTargetId(
      cycles.find((c) => c.id === initialTargetId)?.id ?? cycles[0]?.id ?? null,
    );
    setReason("");
    setWithKids(true);
    setErr(null);
    setBusy(false);
  }, [item, cycles, initialTargetId]);

  // Новый срок по умолчанию — последний день цели, и только когда старый она срывает.
  useEffect(() => {
    setNewDue(target && broken ? target.end_date : "");
  }, [target, broken]);

  if (!item) return null;
  const canSubmit = !!target && reason.trim().length > 0 && !busy;

  async function submit() {
    if (!item || !target || !reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await moveSprintTask(cycleId, item.id, {
        target_cycle_id: target.id,
        reason: reason.trim(),
        new_due: broken && newDue ? newDue : null,
      });
      // Подзадачи — тем же переносом с той же причиной; срок у них свой, его не трогаем.
      if (withKids) {
        for (const kid of kids) {
          await moveSprintTask(cycleId, kid.id, {
            target_cycle_id: target.id,
            reason: reason.trim(),
          });
        }
      }
      await onDone();
      onClose();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось перенести", "Could not move the task"),
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
          aria-labelledby="move-task-title"
          className="fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="move-task-title"
            className="font-heading text-[16px] font-bold text-ink"
          >
            {target
              ? dt(`Перенести в ${target.name}`, `Move to ${target.name}`)
              : dt("Перенести в другой спринт", "Move to another sprint")}
          </DialogPrimitive.Title>
          <p className="-mt-2 truncate text-[12.5px] text-ink-mute">
            «{item.title}»
          </p>

          {cycles.length === 0
            ? (
              <p className="rounded-[8px] border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft">
                {dt(
                  "Запланированных спринтов нет — сначала заведите следующий спринт.",
                  "There are no planned sprints — create the next sprint first.",
                )}
              </p>
            )
            : (
              <div
                className="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-label={dt("Спринт-цель", "Target sprint")}
              >
                {cycles.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    title={c.name}
                    aria-checked={c.id === targetId}
                    onClick={() => setTargetId(c.id)}
                    className={cn(
                      "rounded-[8px] border px-2.5 py-1 text-left text-[12.5px] font-medium",
                      c.id === targetId
                        ? "border-primary/50 bg-primary/12 text-primary"
                        : "border-line text-ink-soft hover:text-ink",
                    )}
                  >
                    {c.id === flagId ? "🏁 " : ""}
                    {cycleShort(c.name)}
                    <span className="ml-1.5 font-mono text-[11px] opacity-70">
                      {cycleDates(c)}
                    </span>
                  </button>
                ))}
              </div>
            )}

          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">
              {dt(
                "Почему не успели в этом спринте?",
                "Why didn't it fit into this sprint?",
              )}
            </span>
            <textarea
              autoFocus
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={dt(
                "Например: ждём ответа юристов",
                "For example: waiting for the lawyers",
              )}
              className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent-line"
            />
          </label>

          {kids.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
              <input
                type="checkbox"
                checked={withKids}
                onChange={(e) => setWithKids(e.target.checked)}
                className="accent-[var(--primary)]"
              />
              {dt(
                `и незакрытые подзадачи этого спринта (${kids.length})`,
                `and the open subtasks of this sprint (${kids.length})`,
              )}
            </label>
          )}

          {due && target && (
            broken
              ? (
                <div className="flex flex-col gap-1.5 rounded-[8px] border border-pri-high/40 bg-pri-high/8 px-3 py-2 text-[12.5px]">
                  <span className="font-semibold text-pri-high">
                    {dt(
                      `Срок ${fmtDayShort(due)} будет сорван.`,
                      `The ${fmtDayShort(due)} deadline will be missed.`,
                    )}
                  </span>
                  <label className="flex flex-wrap items-center gap-2 text-ink-soft">
                    {dt("Новый срок:", "New deadline:")}
                    <input
                      type="date"
                      value={newDue}
                      onChange={(e) => setNewDue(e.target.value)}
                      className="rounded-[6px] border border-line bg-surface px-2 py-0.5 font-mono text-[12.5px] text-ink"
                    />
                    {newDue && (
                      <button
                        type="button"
                        onClick={() => setNewDue("")}
                        className="text-[12px] text-ink-mute underline-offset-2 hover:text-ink hover:underline"
                      >
                        {dt("стереть", "clear")}
                      </button>
                    )}
                  </label>
                  {!newDue && (
                    <span className="text-[11.5px] text-ink-mute">
                      {dt(
                        "Срок не изменится — задача останется просроченной.",
                        "The deadline stays — the task remains overdue.",
                      )}
                    </span>
                  )}
                </div>
              )
              : (
                <p className="rounded-[8px] border border-line px-3 py-2 text-[12.5px] text-ink-soft">
                  {dt(
                    `Срок ${fmtDayShort(due)} не меняется — успеваете.`,
                    `The ${fmtDayShort(due)} deadline stays — you are on time.`,
                  )}
                </p>
              )
          )}

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
              disabled={!canSubmit}
              className={cn(
                PILL_BTN,
                "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
              )}
            >
              {busy ? dt("Переносим…", "Moving…") : dt("Перенести", "Move")}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
