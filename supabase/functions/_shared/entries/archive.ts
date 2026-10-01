// Архивация записи вместо удаления (#569) — одна на все поверхности: веб, бот, MCP.
//
// Владелец 28.09.2026: «давай заведем такую же систему как для задач что встречи при удалении не
// удаляются и архивируются». Запись получает `archived_at`/`archived_by` и пропадает у всех
// читателей (`live.ts`, сторож `live.guard.test.ts`), но остаётся в базе и возвращается одним
// UPDATE. Файл в Storage при этом НЕ удаляется: отдача файла проверяет живую запись
// (`swarm-api/file-access.ts`), поэтому по старой ссылке он недоступен, а данные целы.
//
// Задачи встречи архивируются тем же патчем, что и обычное удаление задачи (`archivePatch`,
// `_shared/tasks/live.ts`): прежде бот стирал их вместе с журналом физически (#687). Связь задачи
// со встречей — `tasks.meeting_id`, и в нём живут два ключа: веб пишет id записи, бот и рекордер —
// `metadata.meeting_id` исходной встречи. Поэтому архивируем по обоим.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { archivePatch } from "../tasks/live.ts";

export type ArchivableEntry = { id: string; metadata?: Record<string, unknown> | null };

export type ArchiveResult = { error: string | null; archivedTasks: number };

/** Ключи, по которым задачи ссылаются на встречу: id записи и id исходной встречи. */
export function meetingTaskKeys(entry: ArchivableEntry): string[] {
  const source = entry.metadata?.meeting_id;
  const keys = [entry.id];
  if (typeof source === "string" && source !== "" && source !== entry.id) keys.push(source);
  return keys;
}

/**
 * Архивировать запись и задачи её встречи. Право на удаление проверяет вызывающий — здесь только
 * действие. Ошибка не глушится: запись не ушла в архив → задачи не трогаем.
 */
export async function archiveEntry(
  supabase: SupabaseClient,
  entry: ArchivableEntry,
  archivedBy: number | null,
): Promise<ArchiveResult> {
  const patch = archivePatch(archivedBy);
  const { error } = await supabase.from("entries").update(patch).eq("id", entry.id).is("archived_at", null);
  if (error) return { error: error.message, archivedTasks: 0 };

  const { data, error: tasksError } = await supabase.from("tasks")
    .update(patch)
    .in("meeting_id", meetingTaskKeys(entry))
    .is("archived_at", null)
    .select("id");
  if (tasksError) return { error: tasksError.message, archivedTasks: 0 };
  return { error: null, archivedTasks: (data ?? []).length };
}
