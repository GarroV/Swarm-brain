import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TaskDependency, DependencyType } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export type DepEdge = TaskDependency & { direction: "outgoing" | "incoming" };

// Все зависимости задачи: исходящие (task_id = id) и входящие (depends_on_id = id).
export async function listDependencies(taskId: string): Promise<DepEdge[]> {
  const [out, inc] = await Promise.all([
    supabase.from("task_dependencies").select("*").eq("task_id", taskId),
    supabase.from("task_dependencies").select("*").eq("depends_on_id", taskId),
  ]);
  const outgoing = ((out.data ?? []) as TaskDependency[]).map(d => ({ ...d, direction: "outgoing" as const }));
  const incoming = ((inc.data ?? []) as TaskDependency[]).map(d => ({ ...d, direction: "incoming" as const }));
  return [...outgoing, ...incoming];
}

export type CreateDepResult =
  | { ok: true; dependency: TaskDependency }
  | { ok: false; reason: "cycle" | "duplicate" };

// Создаёт зависимость task_id → depends_on_id с защитой от циклов.
// Цикл: если depends_on_id уже (транзитивно) зависит от task_id, то новая
// связь замкнёт граф. Проверяем через рекурсивный get_all_dependencies.
export async function createDependency(
  taskId: string,
  dependsOnId: string,
  type: DependencyType,
): Promise<CreateDepResult> {
  const { data: deps } = await supabase.rpc("get_all_dependencies", { root_id: dependsOnId });
  const reachable = ((deps ?? []) as Array<{ id: string }>).map(d => d.id);
  if (reachable.includes(taskId)) return { ok: false, reason: "cycle" };

  const { data, error } = await supabase.from("task_dependencies").insert({
    task_id: taskId,
    depends_on_id: dependsOnId,
    dependency_type: type,
  }).select().single();

  if (error) {
    if (error.code === "23505") return { ok: false, reason: "duplicate" }; // unique violation
    throw new Error(error.message);
  }
  return { ok: true, dependency: data as TaskDependency };
}

// Удаляет зависимость по id, но только если она принадлежит указанной задаче.
export async function deleteDependency(taskId: string, depId: string): Promise<boolean> {
  const { data } = await supabase.from("task_dependencies")
    .delete().eq("id", depId).eq("task_id", taskId).select("id").maybeSingle();
  return !!data;
}
