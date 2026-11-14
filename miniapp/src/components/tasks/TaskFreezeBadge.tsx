"use client";
import { isTaskFrozen } from "@/lib/smartLists";
import { TASK_LIFECYCLE_COPY as COPY } from "@/lib/taskLifecycleCopy";
import { useDt } from "@/components/roy/nav";

export function TaskFreezeBadge({ task }: { task: { frozen_at?: string | null; task_frozen?: boolean } }) {
  const dt = useDt();
  return isTaskFrozen(task)
    ? <span className="shrink-0 rounded border border-line px-1.5 text-[11px] font-semibold text-ink-soft">{dt(COPY.marker.ru, COPY.marker.en)}</span>
    : null;
}
