import { supabase } from "../lib/supabase.ts";
import {
  createTask,
  deleteTask,
  getVisibleTaskInWorkspace,
  listTasks,
  type RecurResult,
  updateTask,
} from "../../_shared/tasks/db.ts";
import type { Task, TaskInput } from "../../_shared/tasks/types.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";
import {
  dropUnknownProjects,
  loadProjectVisibility,
  visibleProjectFilter,
} from "../../_shared/tasks/project-visibility.ts";

/**
 * Кто и где действует. id задачи в боте приходит из callback_data, то есть от клиента, и сам по
 * себе ничего не доказывает: задача обязана быть из пространства человека и не из проекта,
 * которого он не видит (решение владельца 16.10.2026). Без области задачу по id не прочитать
 * и не изменить — тип не даст забыть.
 */
export type TaskScope = { groupId: string; viewerId: number };

/** Задача, если она в области человека; иначе null — как «задачи нет». */
export function dbGetTask(id: string, scope: TaskScope): Promise<Task | null> {
  return getVisibleTaskInWorkspace(id, scope.groupId, scope.viewerId);
}

export function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
  // Обязателен: выборка без пространства отдала бы задачи всех пространств.
  groupId: string;
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
// Задача вне области не правится: правка молча не применяется, а следующий dbGetTask отвечает
// «задача не найдена» — так же, как на удалённую.
export async function dbUpdateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
  opts: { actor?: string; actorTelegramId?: number },
  scope: TaskScope,
): Promise<RecurResult | null> {
  if (!(await dbGetTask(id, scope))) return null;
  return await updateTask(id, fields, opts);
}

/** Убрать задачу в архив. false — задачи нет в области человека, ничего не тронуто. */
export async function dbDeleteTask(id: string, scope: TaskScope): Promise<boolean> {
  if (!(await dbGetTask(id, scope))) return false;
  await deleteTask(id, scope.viewerId);
  return true;
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

/** «Выполненные» в меню списков: последние закрытые задачи пространства, видимые человеку. */
export async function dbListDone(groupId: string, viewerId: number): Promise<Task[]> {
  const visibility = await loadProjectVisibility(groupId, viewerId);
  let q = onlyLive(supabase.from("tasks").select("*")).eq("group_id", groupId).eq("status", "done");
  const projectFilter = visibleProjectFilter(visibility.hidden);
  if (projectFilter) q = q.or(projectFilter);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(15);
  if (error) throw new Error(`done tasks: ${error.message}`);
  return dropUnknownProjects((data ?? []) as Task[], visibility.known);
}

/** Экспорт задач пространства в таблицу: всё, кроме черновиков, видимое человеку. */
export async function dbListForExport(groupId: string, viewerId: number): Promise<Task[]> {
  const visibility = await loadProjectVisibility(groupId, viewerId);
  let q = onlyLive(supabase.from("tasks").select("*")).eq("group_id", groupId)
    .not("status", "in", '("draft")');
  const projectFilter = visibleProjectFilter(visibility.hidden);
  if (projectFilter) q = q.or(projectFilter);
  const { data, error } = await q.order("due_date", { ascending: true }).limit(500);
  if (error) throw new Error(`export tasks: ${error.message}`);
  return dropUnknownProjects((data ?? []) as Task[], visibility.known);
}
