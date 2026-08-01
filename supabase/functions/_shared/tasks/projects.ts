import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Project, ProjectInput } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Все операции изолированы по group_id — проект принадлежит воркспейсу.

export type ProjectWithCounts = Project & { task_count: number; backlog_count: number };

// Проекты воркспейса + счётчики: всего задач в проекте и из них в бэклоге (project_linked=false).
export async function listProjects(groupId: string): Promise<ProjectWithCounts[]> {
  const { data: projects } = await supabase
    .from("projects").select("*").eq("group_id", groupId)
    .order("created_at", { ascending: true });
  const list = (projects ?? []) as Project[];
  if (list.length === 0) return [];

  // Считаем задачи по проектам одним запросом (без N+1).
  const { data: tasks } = await supabase
    .from("tasks").select("project_id, project_linked")
    .eq("group_id", groupId)
    .in("project_id", list.map((p) => p.id));
  const counts = new Map<string, { total: number; backlog: number }>();
  ((tasks ?? []) as Array<{ project_id: string | null; project_linked: boolean }>).forEach((t) => {
    if (!t.project_id) return;
    const c = counts.get(t.project_id) ?? { total: 0, backlog: 0 };
    c.total += 1;
    if (!t.project_linked) c.backlog += 1;
    counts.set(t.project_id, c);
  });
  return list.map((p) => ({
    ...p,
    task_count: counts.get(p.id)?.total ?? 0,
    backlog_count: counts.get(p.id)?.backlog ?? 0,
  }));
}

export async function createProject(
  input: ProjectInput,
  groupId: string,
  createdBy: number | null,
): Promise<Project> {
  const { data, error } = await supabase.from("projects").insert({
    group_id: groupId,
    name: input.name,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    created_by: createdBy,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Project;
}

// Обновляет только проект своего воркспейса. Возвращает обновлённый или null (не найден/чужой).
export async function updateProject(
  id: string,
  fields: Partial<ProjectInput>,
  groupId: string,
): Promise<Project | null> {
  const { data } = await supabase.from("projects")
    .update(fields)
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as Project | null) ?? null;
}

// Удаляет проект своего воркспейса. Задачи освобождаются (FK ON DELETE SET NULL для project_id),
// а project_linked сбрасываем явно (FK его не трогает).
export async function deleteProject(id: string, groupId: string): Promise<boolean> {
  const { data } = await supabase.from("projects")
    .delete().eq("id", id).eq("group_id", groupId).select("id").maybeSingle();
  if (!data) return false;
  await supabase.from("tasks")
    .update({ project_linked: false })
    .eq("group_id", groupId).is("project_id", null).eq("project_linked", true);
  return true;
}

export async function projectInWorkspace(id: string, groupId: string): Promise<boolean> {
  const { data } = await supabase
    .from("projects").select("id").eq("id", id).eq("group_id", groupId).maybeSingle();
  return !!data;
}
