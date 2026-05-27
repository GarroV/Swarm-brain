import { supabase } from "../lib/supabase.ts";
import type { Task, TaskInput } from "./types.ts";

export async function dbGetTask(id: string): Promise<Task | null> {
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return data as Task | null;
}

export async function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
}): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (opts.status) {
    q = q.eq("status", opts.status);
  } else {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (opts.country) q = q.ilike("country", `%${opts.country}%`);

  if (opts.telegramId !== undefined) {
    q = q.contains("assignee_telegram_ids", [opts.telegramId]);
  }

  if (opts.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  const { data } = await q.limit(opts.limit ?? 200);
  let tasks = (data ?? []) as Task[];

  if (opts.assignee) {
    const lower = opts.assignee.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(lower)));
  }

  return tasks;
}

export async function dbCreateTask(input: TaskInput): Promise<Task> {
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
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function dbUpdateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
): Promise<void> {
  await supabase.from("tasks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function dbDeleteTask(id: string): Promise<void> {
  await supabase.from("task_history").delete().eq("task_id", id);
  await supabase.from("tasks").delete().eq("id", id);
}

export async function dbListAllOpen(): Promise<Task[]> {
  const { data } = await supabase.from("tasks").select("*")
    .not("status", "in", '("done","cancelled","draft","pending")')
    .order("assignees", { ascending: true })
    .limit(200);
  return (data ?? []) as Task[];
}
