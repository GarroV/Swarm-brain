import { historyRowsFor } from "./history.ts";
import type { Task } from "./types.ts";

/** Task freeze is independent of status and of immutable sprint snapshots (#814). */
export type TaskFreeze = { frozen_at?: string | null; task_frozen?: boolean };

export function isTaskFrozen(task: TaskFreeze): boolean {
  return task.task_frozen === true || task.frozen_at != null;
}

/** Only pause fields change. The existing transactional task journal records the change. */
export function freezeTaskUpdate(task: Task, frozen: boolean, actor: number, now: string) {
  if (isTaskFrozen(task) === frozen) return null;
  const patch = { frozen_at: frozen ? now : null, frozen_by: frozen ? actor : null, updated_at: now };
  return {
    p_task_id: task.id,
    p_patch: patch,
    p_expect: {
      group_id: task.group_id ?? null,
      project_id: task.project_id,
      archived_at: null,
      frozen_at: task.frozen_at ?? null,
      frozen_by: task.frozen_by ?? null,
    },
    p_history: historyRowsFor({
      taskId: task.id,
      snapshot: task as unknown as Record<string, unknown>,
      patch,
      actorTelegramId: actor,
      groupId: task.group_id,
    }),
  };
}

export const TASK_CONFLICT_MESSAGE = "Task changed; reload and try again";

/** Only current stats-affecting rows participate; historical snapshots keep their stored flag. */
export function freezeExpectation(
  items: ReadonlyArray<{
    task_id: string | null;
    frozen?: boolean;
    removed?: boolean;
    moved?: unknown;
    task_frozen?: boolean;
    withdrawn_at?: string | null;
  }>,
): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const item of items) {
    if (!item.task_id || item.frozen || item.removed || item.moved) continue;
    flags[item.task_id] = item.task_frozen === true;
  }
  return flags;
}
