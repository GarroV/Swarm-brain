"use client";
import { useState } from "react";
import type { Task } from "@/types";
import { setTaskFrozen } from "@/lib/api";
import { isTaskFrozen } from "@/lib/smartLists";
import { TASK_LIFECYCLE_COPY as COPY } from "@/lib/taskLifecycleCopy";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";

export function useTaskFreeze(task: Task, onPatch?: (patch: Partial<Task>) => void) {
  const dt = useDt();
  const { bumpTasks, toast } = useRoyNav();
  const [busy, setBusy] = useState(false);
  const frozen = isTaskFrozen(task);
  const copy = frozen ? COPY.unfreeze : COPY.freeze;
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await setTaskFrozen(task.id, !frozen);
      onPatch?.(updated);
      bumpTasks();
    } catch {
      toast(dt(COPY.failed.ru, COPY.failed.en));
    } finally { setBusy(false); }
  };
  return { busy, frozen, label: dt(copy.ru, copy.en), toggle };
}

export function TaskFreezeButton({ task, onPatch }: { task: Task; onPatch?: (patch: Partial<Task>) => void }) {
  const action = useTaskFreeze(task, onPatch);
  return (
    <button type="button" title={action.label} aria-label={action.label} aria-pressed={action.frozen}
      disabled={action.busy} onClick={(e) => { e.stopPropagation(); void action.toggle(); }}
      className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line-2 bg-surface text-ink-soft hover:bg-surface-2 disabled:opacity-50">
      <RoyIcon name={action.frozen ? "arrow" : "clock"} size={14} />
    </button>
  );
}
