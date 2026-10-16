import { supabase } from "../lib/supabase.ts";
import { createTask, deleteTask, getTask, listTasks, type RecurResult, updateTask } from "../../_shared/tasks/db.ts";
import type { Task, TaskInput } from "../../_shared/tasks/types.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";
import {
  dropUnknownProjects,
  loadProjectVisibility,
  visibleProjectFilter,
} from "../../_shared/tasks/project-visibility.ts";

export function dbGetTask(id: string): Promise<Task | null> {
  return getTask(id);
}

export function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
  groupId?: string;
  /** Кто смотрит: задачи невидимых ему проектов не показываются (без зрителя — скрыты все закрытые). */
  viewerId?: number;
}): Promise<Task[]> {
  return listTasks({
    status: opts.status,
    country: opts.country,
    period: opts.period,
    telegramId: opts.telegramId,
    viewerId: opts.viewerId,
    assigneeText: opts.assignee,
    limit: opts.limit,
  }, opts.groupId);
}

export function dbCreateTask(input: TaskInput): Promise<Task> {
  return createTask(input, input.group_id ?? undefined);
}

// Возвращает признак переката регулярной задачи (null — обычное обновление): бот обязан
// сказать «Готово, следующий срок …», иначе он соврёт про закрытие незакрытой задачи.
export function dbUpdateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
  opts: { actor?: string; actorTelegramId?: number } = {},
): Promise<RecurResult | null> {
  return updateTask(id, fields, opts);
}

export function dbDeleteTask(
  id: string,
  archivedBy?: number,
): Promise<void> {
  return deleteTask(id, archivedBy);
}

// listAllOpen сортирует по assignees (не по due_date) — остаётся вне shared движка
export async function dbListAllOpen(groupId?: string, viewerId?: number): Promise<Task[]> {
  let q = onlyLive(supabase.from("tasks").select("*"))
    .not("status", "in", '("done","cancelled","draft")')
    // Незавершённый /addtask (confirmed:false, между «Задача?» и вводом дедлайна) не должен
    // мелькать в команде — тот же принцип, что уже используют MCP и miniapp (см. addtask_title).
    .eq("confirmed", true)
    .order("assignees", { ascending: true });
  if (groupId) q = q.eq("group_id", groupId);
  // Задачи закрытых проектов — только тем, кто видит проект (тот же фильтр, что в listTasks).
  const visibility = await loadProjectVisibility(groupId, viewerId);
  const projectFilter = visibleProjectFilter(visibility.hidden);
  if (projectFilter) q = q.or(projectFilter);
  const { data } = await q.limit(200);
  return dropUnknownProjects((data ?? []) as Task[], visibility.known);
}

export async function dbListToday(telegramId: number, groupId?: string): Promise<Task[]> {
  const [mine, allTag] = await Promise.all([
    listTasks({ dueToday: true, telegramId, viewerId: telegramId, limit: 30 }, groupId),
    listTasks({ dueToday: true, viewerId: telegramId, limit: 50 }, groupId),
  ]);
  const allFiltered = allTag.filter((t) => (t.tags ?? []).includes("#all"));
  const seen = new Set<string>();
  return [...mine, ...allFiltered].filter((t) => !seen.has(t.id) && seen.add(t.id));
}
