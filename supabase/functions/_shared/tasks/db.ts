import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Task, TaskInput } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function createTask(input: TaskInput, groupId?: string): Promise<Task> {
  const { data, error } = await supabase.from("tasks").insert({
    title: input.title,
    description: input.description ?? null,
    assignees: input.assignees ?? [],
    assignee_telegram_ids: input.assignee_telegram_ids ?? [],
    due_date: input.due_date ?? null,
    tags: input.tags ?? [],
    country: input.country ?? null,
    task_role: input.task_role ?? null,
    source: input.source ?? "manual",
    status: input.status ?? "open",
    meeting_id: input.meeting_id ?? null,
    group_id: groupId ?? input.group_id ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function getTask(id: string): Promise<Task | null> {
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return data as Task | null;
}

export async function listTasks(filters: {
  status?: string;
  country?: string;
  period?: string;
  telegramId?: number;
  assigneeText?: string;
  limit?: number;
}, groupId?: string): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (filters.status) {
    q = q.eq("status", filters.status);
  } else {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (filters.country) q = q.ilike("country", `%${filters.country}%`);

  if (filters.telegramId !== undefined) {
    q = q.contains("assignee_telegram_ids", [filters.telegramId]);
  }

  if (filters.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  if (groupId) q = q.eq("group_id", groupId);

  const { data } = await q.limit(filters.limit ?? 200);
  let tasks = (data ?? []) as Task[];

  if (filters.assigneeText) {
    const lower = filters.assigneeText.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(lower)));
  }

  return tasks;
}

export async function updateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
): Promise<void> {
  await supabase.from("tasks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function deleteTask(id: string): Promise<void> {
  await supabase.from("task_history").delete().eq("task_id", id);
  await supabase.from("tasks").delete().eq("id", id);
}
