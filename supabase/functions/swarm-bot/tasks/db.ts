import { supabase } from "../lib/supabase.ts";
import { createTask, getTask, listTasks, updateTask, deleteTask } from "../../_shared/tasks/db.ts";
import type { Task, TaskInput } from "../../_shared/tasks/types.ts";

export async function dbGetTask(id: string): Promise<Task | null> {
  return getTask(id);
}

export async function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
  groupId?: string;
}): Promise<Task[]> {
  return listTasks({
    status: opts.status,
    country: opts.country,
    period: opts.period,
    telegramId: opts.telegramId,
    assigneeText: opts.assignee,
    limit: opts.limit,
  }, opts.groupId);
}

export async function dbCreateTask(input: TaskInput): Promise<Task> {
  return createTask(input, input.group_id ?? undefined);
}

export async function dbUpdateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
): Promise<void> {
  return updateTask(id, fields);
}

export async function dbDeleteTask(id: string): Promise<void> {
  return deleteTask(id);
}

// listAllOpen сортирует по assignees (не по due_date) — остаётся вне shared движка
export async function dbListAllOpen(groupId?: string): Promise<Task[]> {
  let q = supabase.from("tasks").select("*")
    .not("status", "in", '("done","cancelled","draft")')
    .order("assignees", { ascending: true });
  if (groupId) q = q.eq("group_id", groupId);
  const { data } = await q.limit(200);
  return (data ?? []) as Task[];
}
