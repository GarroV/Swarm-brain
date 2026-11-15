// Архив задач (#489): посмотреть, что убрано, и вернуть. С 21.09.2026 «удалить задачу» значит
// архивировать (#427), а заглянуть в архив было негде — убранное по ошибке возвращали руками
// в базе. Права те же, что у удаления: задача своего воркспейса (решение 2026-10-09).
import { apiErr, corsHeaders, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import {
  deleteTask,
  getArchivedTask,
  getTask,
  listArchivedTasks,
  restoreTask,
  TaskUserError,
} from "../_shared/tasks/db.ts";

import { taskVisibleByProject } from "../_shared/tasks/project-visibility.ts";
import { permanentlyDeleteTask, setTaskFrozen } from "../_shared/tasks/task-lifecycle.ts";

export async function handleTaskArchiveRoutes(
  req: Request,
  routePath: string,
  groupId: string,
  origin: string,
  telegramId?: number,
): Promise<Response | null> {
  if (routePath === "/tasks/archived" && req.method === "GET") {
    try {
      const rows = await listArchivedTasks(groupId);
      return json(rows, 200, origin);
    } catch (e) {
      return serverError(origin, "tasks archived", e);
    }
  }

  const restore = routePath.match(/^\/tasks\/([^/]+)\/restore$/);
  if (restore && req.method === "POST") {
    const task = await getArchivedTask(restore[1]);
    // Чужой воркспейс — 404, как «нет такой»: перебор id не выдаёт чужих задач.
    if (!task || task.group_id !== groupId) {
      return apiErr(404, "Not found", origin);
    }
    try {
      await restoreTask(task.id);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    } catch (e) {
      return serverError(origin, "tasks restore", e);
    }
  }
  const lifecycle = routePath.match(/^\/tasks\/([^/]+)\/(freeze|permanent)$/);
  if (
    lifecycle && ((lifecycle[2] === "freeze" && req.method === "POST") ||
      (lifecycle[2] === "permanent" && req.method === "DELETE"))
  ) {
    const permanent = lifecycle[2] === "permanent";
    const task = permanent ? await getArchivedTask(lifecycle[1]) : await getTask(lifecycle[1]);
    if (!task || task.group_id !== groupId || !(await taskVisibleByProject(task, telegramId))) {
      return apiErr(404, "Not found", origin);
    }
    try {
      if (permanent) {
        if (!(await permanentlyDeleteTask(task))) return apiErr(409, "Task changed; reload and try again", origin);
      } else {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return apiErr(400, "Invalid JSON", origin);
        }
        if (!body || typeof body !== "object" || typeof (body as { frozen?: unknown }).frozen !== "boolean") {
          return apiErr(400, "frozen must be a boolean", origin);
        }
        if (telegramId === undefined) return apiErr(404, "Not found", origin);
        await setTaskFrozen(task, (body as { frozen: boolean }).frozen, telegramId);
        const updated = await getTask(task.id);
        if (!updated || updated.group_id !== groupId || !(await taskVisibleByProject(updated, telegramId))) {
          return apiErr(409, "Task changed; reload and try again", origin);
        }
        return json(updated, 200, origin);
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    } catch (e) {
      if (e instanceof TaskUserError) return apiErr(e.status, e.message, origin);
      return serverError(origin, "tasks lifecycle", e);
    }
  }

  // The existing DELETE still archives; permanent deletion has a separate archived-only route.
  const archive = routePath.match(/^\/tasks\/([^/]+)$/);
  if (archive && req.method === "DELETE") {
    const task = await getTask(archive[1]);
    if (!task || task.group_id !== groupId || !(await taskVisibleByProject(task, telegramId))) {
      return apiErr(404, "Not found", origin);
    }
    try {
      await deleteTask(task.id, telegramId);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    } catch (e) {
      if (e instanceof TaskUserError) return apiErr(e.status, e.message, origin);
      return serverError(origin, "tasks delete", e);
    }
  }
  return null;
}
