import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { commentTaskGuard, toolAddTaskComment, toolDeleteTaskComment, toolGetTaskComments } from "./tools.ts";
import { commentEditDeps, type EditCommentArgs, editOwnTaskComment } from "./comment-edit.ts";

export const TASK_COMMENT_TOOLS = ["get_task_comments", "add_task_comment", "edit_task_comment", "delete_task_comment"];

export async function taskCommentTool(
  db: SupabaseClient,
  name: string,
  args: { task_id: string; comment_id: string; content: string; requesting_user_id: number },
): Promise<string> {
  if (name === "get_task_comments") return await toolGetTaskComments(args);
  if (name === "add_task_comment") return await toolAddTaskComment(args);
  if (name === "delete_task_comment") return await toolDeleteTaskComment(args);
  if (name !== "edit_task_comment") throw new Error("unknown comment tool");
  return await editOwnTaskComment(args as EditCommentArgs, commentEditDeps(db, commentTaskGuard));
}
