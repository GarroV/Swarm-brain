// Архив задач (#489): посмотреть, что убрано, и вернуть. С 21.09.2026 «удалить задачу» значит
// архивировать (#427), а заглянуть в архив было негде — убранное по ошибке возвращали руками
// в базе. Права те же, что у удаления: задача своего воркспейса (решение 2026-10-09).
import { apiErr, corsHeaders, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { getArchivedTask, listArchivedTasks, restoreTask } from "../_shared/tasks/db.ts";

export async function handleTaskArchiveRoutes(
  req: Request,
  routePath: string,
  groupId: string,
  origin: string,
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
  return null;
}
