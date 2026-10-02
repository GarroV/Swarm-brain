// Архив задач (#489): посмотреть, что убрано, и вернуть. С 21.09.2026 «удалить задачу» значит
// архивировать (#427), а заглянуть в архив было негде — убранное по ошибке возвращали руками
// в базе. Права те же, что у удаления: видеть — `canViewTask`, вернуть — `canMutateTask`.
import { apiErr, corsHeaders, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { getArchivedTask, listArchivedTasks, restoreTask } from "../_shared/tasks/db.ts";
import { canMutateTask, canViewTask } from "../_shared/tasks/access.ts";

export async function handleTaskArchiveRoutes(
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
): Promise<Response | null> {
  if (routePath === "/tasks/archived" && req.method === "GET") {
    try {
      const rows = await listArchivedTasks(groupId);
      return json(rows.filter((t) => canViewTask(t, telegramId, isAdmin)), 200, origin);
    } catch (e) {
      return serverError(origin, "tasks archived", e);
    }
  }

  const restore = routePath.match(/^\/tasks\/([^/]+)\/restore$/);
  if (restore && req.method === "POST") {
    const task = await getArchivedTask(restore[1]);
    // Чужой воркспейс и чужая личная — 404, как «нет такой»: иначе перебор id показывает,
    // что у коллеги есть личная задача.
    if (!task || task.group_id !== groupId || !canViewTask(task, telegramId, isAdmin)) {
      return apiErr(404, "Not found", origin);
    }
    if (!canMutateTask(task, telegramId, isAdmin)) return apiErr(403, "Forbidden", origin);
    try {
      await restoreTask(task.id);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    } catch (e) {
      return serverError(origin, "tasks restore", e);
    }
  }
  return null;
}
