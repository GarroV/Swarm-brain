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
    priority: input.priority ?? null,
    source: input.source ?? "manual",
    status: input.status ?? "open",
    meeting_id: input.meeting_id ?? null,
    group_id: groupId ?? input.group_id ?? null,
    confirmed: input.confirmed ?? false,
    created_by_telegram_id: input.created_by_telegram_id ?? null,
    is_private: input.is_private ?? false,
    owner_id: input.owner_id ?? null,
    start_date: input.start_date ?? null,
    timeline_position: input.timeline_position ?? null,
    sprint_id: input.sprint_id ?? null,
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
  confirmed?: boolean;
  createdBy?: number;
  dueToday?: boolean;
  // Модуль задач (Рой):
  viewerId?: number;        // для visibility приватных задач
  isAdmin?: boolean;        // админ видит все приватные
  sprintId?: string;
  tags?: string[];          // ANY-совпадение (overlaps)
  startDateFrom?: string;
  startDateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}, groupId?: string): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });

  // Видимость приватных задач: приватная видна только владельцу (админ — все).
  // Безопасный дефолт: без viewerId показываем только публичные.
  if (!filters.isAdmin) {
    if (filters.viewerId !== undefined) {
      q = q.or(`is_private.eq.false,owner_id.eq.${filters.viewerId}`);
    } else {
      q = q.eq("is_private", false);
    }
  }

  if (filters.confirmed !== undefined) {
    q = q.eq("confirmed", filters.confirmed);
  } else if (!filters.dueToday) {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.country) q = q.ilike("country", `%${filters.country}%`);
  if (filters.createdBy !== undefined) q = q.eq("created_by_telegram_id", filters.createdBy);
  if (filters.sprintId) q = q.eq("sprint_id", filters.sprintId);
  if (filters.tags && filters.tags.length > 0) q = q.overlaps("tags", filters.tags);
  if (filters.startDateFrom) q = q.gte("start_date", filters.startDateFrom);
  if (filters.startDateTo) q = q.lte("start_date", filters.startDateTo);
  if (filters.dueDateFrom) q = q.gte("due_date", filters.dueDateFrom);
  if (filters.dueDateTo) q = q.lte("due_date", filters.dueDateTo);

  if (filters.telegramId !== undefined) {
    q = q.contains("assignee_telegram_ids", [filters.telegramId]);
  }

  if (filters.dueToday) {
    const today = new Date().toISOString().split("T")[0];
    q = q.lte("due_date", today).eq("confirmed", true);
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
