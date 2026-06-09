import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Sprint, SprintInput } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Все операции изолированы по group_id — спринт принадлежит воркспейсу.

export async function listSprints(groupId: string): Promise<Sprint[]> {
  const { data } = await supabase
    .from("sprints").select("*").eq("group_id", groupId)
    .order("start_date", { ascending: false });
  return (data ?? []) as Sprint[];
}

export async function createSprint(input: SprintInput, groupId: string): Promise<Sprint> {
  const { data, error } = await supabase.from("sprints").insert({
    group_id: groupId,
    name: input.name,
    start_date: input.start_date,
    end_date: input.end_date,
    status: input.status ?? "planned",
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Sprint;
}

// Обновляет только спринт своего воркспейса. Возвращает обновлённый или null (не найден/чужой).
export async function updateSprint(
  id: string,
  fields: Partial<SprintInput>,
  groupId: string,
): Promise<Sprint | null> {
  const { data } = await supabase.from("sprints")
    .update(fields)
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as Sprint | null) ?? null;
}

// Удаляет спринт своего воркспейса. Задачи освобождаются автоматически (FK ON DELETE SET NULL).
export async function deleteSprint(id: string, groupId: string): Promise<boolean> {
  const { data } = await supabase.from("sprints")
    .delete().eq("id", id).eq("group_id", groupId).select("id").maybeSingle();
  return !!data;
}

// Привязывает задачи воркспейса к спринту (массовое назначение sprint_id).
// Только командные задачи (is_private=false) — спринт командный, чужие личные не трогаем.
export async function setTasksSprint(
  taskIds: string[],
  sprintId: string | null,
  groupId: string,
): Promise<number> {
  if (taskIds.length === 0) return 0;
  const { data } = await supabase.from("tasks")
    .update({ sprint_id: sprintId, updated_at: new Date().toISOString() })
    .in("id", taskIds).eq("group_id", groupId).eq("is_private", false)
    .select("id");
  return (data ?? []).length;
}
