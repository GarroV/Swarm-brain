import { validateCommentContent } from "../../_shared/tasks/comments.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface EditCommentArgs {
  task_id: string;
  comment_id: string;
  content: string;
  requesting_user_id: number;
}
export interface EditCommentDeps {
  guard(taskId: string, userId: number): Promise<{ ok: true } | { ok: false; msg: string }>;
  /** One conditional update, restricted to task + comment + token-derived author. */
  updateOwn(taskId: string, commentId: string, authorId: number, content: string): Promise<boolean>;
}

export function commentEditDeps(db: SupabaseClient, guard: EditCommentDeps["guard"]): EditCommentDeps {
  return {
    guard,
    async updateOwn(taskId, commentId, authorId, content) {
      const { data, error } = await db.from("task_comments").update({ content })
        .eq("id", commentId).eq("task_id", taskId).eq("added_by_telegram_id", authorId).select("id").maybeSingle();
      if (error) throw new Error("comment update failed");
      return data !== null;
    },
  };
}

/** Editing neither changes attribution nor re-sends the original comment notification. */
export async function editOwnTaskComment(args: EditCommentArgs, deps: EditCommentDeps): Promise<string> {
  const guard = await deps.guard(args.task_id, args.requesting_user_id);
  if (!guard.ok) return guard.msg;
  const content = validateCommentContent(args.content);
  if (!content.ok) return `Ошибка: ${content.error}`;
  try {
    const updated = await deps.updateOwn(args.task_id, args.comment_id, args.requesting_user_id, content.value);
    return updated ? "✅ Комментарий изменён." : "Комментарий не найден или принадлежит другому автору.";
  } catch {
    return "Ошибка: не удалось изменить комментарий.";
  }
}
