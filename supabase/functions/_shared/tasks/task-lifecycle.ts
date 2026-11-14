// Task freeze and final archive deletion (#814). No status/date/recurrence or notification writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { freezeTaskUpdate } from "./frozen.ts";
import { TaskUserError } from "./db.ts";
import type { Task } from "./types.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export type LifecycleTask = Task & { archived_at?: string | null };

export async function setTaskFrozen(task: LifecycleTask, frozen: boolean, actor: number): Promise<void> {
  const input = freezeTaskUpdate(task, frozen, actor, new Date().toISOString());
  if (!input) return;
  const { error } = await supabase.rpc("task_apply_update", input);
  if (error?.code === "PT409") throw new TaskUserError("Task changed; reload and try again", 409);
  if (error?.code === "PT404") throw new TaskUserError("Not found", 404);
  if (error) throw new Error(`task freeze: ${error.code}`);
}

/** One atomic delete: a concurrent restore or scope/project change prevents deletion. */
export async function permanentlyDeleteTask(task: LifecycleTask): Promise<boolean> {
  if (!task.archived_at || !task.group_id) return false;
  // archive-ok: permanent removal is available only for this exact archived task version.
  let query = supabase.from("tasks").delete().eq("id", task.id)
    .eq("group_id", task.group_id).eq("archived_at", task.archived_at);
  query = task.project_id === null ? query.is("project_id", null) : query.eq("project_id", task.project_id);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw new Error(`task permanent delete: ${error.code}`);
  return !!data;
}
