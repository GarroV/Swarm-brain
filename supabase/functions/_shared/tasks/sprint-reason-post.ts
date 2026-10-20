// Создание комментария из причины, вписанной в спринте. Текст и решение «нужен ли» —
// `sprint-reason-comment.ts` (чистый, под тестами); здесь запись в базу и рассылка.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { afterTaskComment } from "./comment-fanout.ts";
import { resolvePersonNames } from "../users/display-name.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/**
 * Создать комментарий тем же путём, что и обычный (вставка в `task_comments` + `afterTaskComment`:
 * автор подписывается, причастные и подписчики получают уведомление). Сбой не роняет сохранение
 * причины — она уже записана в состав спринта; он только логируется.
 */
export async function postReasonComment(
  taskId: string,
  authorTelegramId: number,
  content: string,
): Promise<void> {
  const { data: task, error: taskErr } = await supabase.from("tasks")
    .select("id, title, group_id, assignee_telegram_ids, created_by_telegram_id")
    .eq("id", taskId).is("archived_at", null).maybeSingle();
  if (taskErr || !task) {
    console.error("sprint reason comment: task load failed:", taskErr?.message ?? "not found");
    return;
  }
  const { data: row, error } = await supabase.from("task_comments")
    .insert({ task_id: taskId, content, added_by_telegram_id: authorTelegramId })
    .select("id").single();
  if (error || !row) {
    console.error("sprint reason comment: insert failed:", error?.message);
    return;
  }
  const names = await resolvePersonNames(supabase, [authorTelegramId]);
  await afterTaskComment(supabase, {
    task: task as {
      id: string;
      title: string;
      group_id: string | null;
      assignee_telegram_ids: number[] | null;
      created_by_telegram_id: number | null;
    },
    commentId: (row as { id: string }).id,
    content,
    actorTelegramId: authorTelegramId,
    actorName: names.get(authorTelegramId) ?? `#${authorTelegramId}`,
  });
}
