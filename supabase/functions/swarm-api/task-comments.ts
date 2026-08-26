import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { validateCommentContent } from "../_shared/tasks/comments.ts";
import { canViewTask } from "../_shared/tasks/access.ts";
import { notifyTaskComment } from "./notifications.ts";
import { ensureCommentSubscription } from "./task-subscriptions.ts";

// Роуты /tasks/:id/comments — комментарии-апдейты к задаче.
// Доступ: задача того же воркспейса (group_id) + приватную видит только владелец/админ.
// Возвращает null, если путь не про комментарии (index.ts идёт дальше).

type CommentRow = { id: string; content: string; added_by_telegram_id: number | null; created_at: string };
type TaskRow = {
  id: string; group_id: string | null; is_private: boolean; owner_id: number | null;
  // Ниже — только для рассылки уведомлений (кому и с каким заголовком), см. notifications.ts.
  title: string; assignee_telegram_ids: number[] | null; created_by_telegram_id: number | null;
};

// Правило приватности — общий гард `_shared/tasks/access.ts` (issue #45): локальная копия
// здесь была ещё одной из шести, а расходятся они молча.
const canView = canViewTask;

async function loadTask(supabase: SupabaseClient, taskId: string): Promise<TaskRow | null> {
  const { data } = await supabase
    .from("tasks")
    .select("id, group_id, is_private, owner_id, title, assignee_telegram_ids, created_by_telegram_id")
    .eq("id", taskId).maybeSingle();
  return (data as TaskRow | null) ?? null;
}

export async function handleTaskCommentRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<Response | null> {
  const listMatch = routePath.match(/^\/tasks\/([^/]+)\/comments$/);
  const oneMatch = routePath.match(/^\/tasks\/([^/]+)\/comments\/([^/]+)$/);
  if (!listMatch && !oneMatch) return null;

  const taskId = (listMatch ?? oneMatch)![1];
  const task = await loadTask(supabase, taskId);
  // 404 и на отсутствие, и на чужой воркспейс/приватность — не палим существование.
  if (!task || task.group_id !== groupId || !canView(task, telegramId, isAdmin)) {
    return json({ error: "Задача не найдена" }, 404, origin);
  }

  // GET /tasks/:id/comments — лента (старые→новые)
  if (listMatch && req.method === "GET") {
    const { data, error } = await supabase
      .from("task_comments")
      .select("id, content, added_by_telegram_id, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("task_comments list failed:", error);
      return json({ error: "Не удалось загрузить комментарии" }, 500, origin);
    }
    const rows = (data ?? []) as CommentRow[];
    const names = await resolveNames(rows.map((r) => r.added_by_telegram_id).filter((x): x is number => !!x));
    return json(rows.map((r) => ({
      id: r.id,
      content: r.content,
      author_telegram_id: r.added_by_telegram_id,
      author_name: r.added_by_telegram_id ? (names.get(r.added_by_telegram_id) ?? String(r.added_by_telegram_id)) : "—",
      created_at: r.created_at,
    })), 200, origin);
  }

  // POST /tasks/:id/comments { content }
  if (listMatch && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { content?: unknown };
    const v = validateCommentContent(body.content);
    if (!v.ok) return json({ error: v.error }, 400, origin);
    const { data, error } = await supabase
      .from("task_comments")
      .insert({ task_id: taskId, content: v.value, added_by_telegram_id: telegramId })
      .select("id, content, added_by_telegram_id, created_at").single();
    if (error) {
      console.error("task_comments insert failed:", error);
      return json({ error: "Не удалось добавить комментарий" }, 500, origin);
    }
    const row = data as CommentRow;
    const names = await resolveNames([telegramId]);
    const actorName = names.get(telegramId) ?? String(telegramId);
    // Участие подписывает: дальше по этой задаче автор получает уведомления, даже если она
    // не его (issue #82). Ранее отписавшегося комментарий НЕ переподписывает.
    await ensureCommentSubscription(supabase, taskId, telegramId);
    // Уведомляем причастных к задаче. Ждём завершения (Edge-функция может быть убита
    // сразу после ответа, и отложенный промис не досчитается), но сбой внутри не роняет
    // ответ: notifyTaskComment ловит свои ошибки сам.
    await notifyTaskComment(supabase, {
      task,
      commentId: row.id,
      content: row.content,
      actorTelegramId: telegramId,
      actorName,
    });
    return json({
      id: row.id,
      content: row.content,
      author_telegram_id: row.added_by_telegram_id,
      author_name: actorName,
      created_at: row.created_at,
    }, 201, origin);
  }

  // DELETE /tasks/:id/comments/:cid — свой коммент или админ
  if (oneMatch && req.method === "DELETE") {
    const commentId = oneMatch[2];
    const { data: c } = await supabase
      .from("task_comments").select("id, added_by_telegram_id").eq("id", commentId).eq("task_id", taskId).maybeSingle();
    if (!c) return json({ error: "Комментарий не найден" }, 404, origin);
    const owns = (c as { added_by_telegram_id: number | null }).added_by_telegram_id === telegramId;
    if (!owns && !isAdmin) return json({ error: "Нельзя удалить чужой комментарий" }, 403, origin);
    const { error } = await supabase.from("task_comments").delete().eq("id", commentId);
    if (error) {
      console.error("task_comments delete failed:", error);
      return json({ error: "Не удалось удалить комментарий" }, 500, origin);
    }
    return json({ ok: true }, 200, origin);
  }

  return null;
}
