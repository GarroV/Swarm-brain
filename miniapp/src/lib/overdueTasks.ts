// The navigation badge shares the task API's existing delta protocol (#492, partial).
import type { Task } from "@/types";
import { mergeTasksDelta, type TasksDeltaResponse } from "./tasksDelta";

export function createOverdueTaskSource({
  full,
  delta,
  now = () => Date.now(),
}: {
  full: () => Promise<Task[]>;
  delta: (since: string) => Promise<TasksDeltaResponse>;
  now?: () => number;
}) {
  let tasks: Task[] | null = null;
  let since: string | null = null;
  let generation = 0;

  return {
    async refresh(): Promise<Task[] | null> {
      const own = ++generation;
      if (tasks !== null && since !== null) {
        const change = await delta(since);
        if (own !== generation) return null;
        if (!change.truncated) {
          tasks = mergeTasksDelta(tasks, change.tasks);
          since = change.serverTime;
          return tasks;
        }
      }
      // Same initial clock overlap as useReminderTasks: the full list has no serverTime.
      const nextSince = new Date(now() - 60_000).toISOString();
      const rows = await full();
      if (own !== generation) return null;
      tasks = rows;
      since = nextSince;
      return tasks;
    },
    cancelPending() {
      generation += 1;
    },
  };
}
