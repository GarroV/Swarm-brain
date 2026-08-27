import { supabase } from "../lib/supabase.ts";
import { createTask, getTask, listTasks, updateTask, deleteTask, type RecurResult } from "../../_shared/tasks/db.ts";
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

// Возвращает признак переката регулярной задачи (null — обычное обновление): бот обязан
// сказать «Готово, следующий срок …», иначе он соврёт про закрытие незакрытой задачи.
export async function dbUpdateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
  opts: { actor?: string } = {},
): Promise<RecurResult | null> {
  return updateTask(id, fields, opts);
}

export async function dbDeleteTask(id: string): Promise<void> {
  return deleteTask(id);
}

// listAllOpen сортирует по assignees (не по due_date) — остаётся вне shared движка
export async function dbListAllOpen(groupId?: string): Promise<Task[]> {
  let q = supabase.from("tasks").select("*")
    .not("status", "in", '("done","cancelled","draft")')
    .eq("is_private", false)  // личные задачи (Рой) не показываем в командных списках бота
    .order("assignees", { ascending: true });
  if (groupId) q = q.eq("group_id", groupId);
  const { data } = await q.limit(200);
  return (data ?? []) as Task[];
}

export async function dbListPending(createdBy: number, groupId?: string): Promise<Task[]> {
  return listTasks({ confirmed: false, createdBy, limit: 20 }, groupId);
}

export async function dbListToday(telegramId: number, groupId?: string): Promise<Task[]> {
  const [mine, allTag] = await Promise.all([
    listTasks({ dueToday: true, telegramId, limit: 30 }, groupId),
    listTasks({ dueToday: true, limit: 50 }, groupId),
  ]);
  const allFiltered = allTag.filter(t => (t.tags ?? []).includes("#all"));
  const seen = new Set<string>();
  return [...mine, ...allFiltered].filter(t => !seen.has(t.id) && seen.add(t.id));
}
