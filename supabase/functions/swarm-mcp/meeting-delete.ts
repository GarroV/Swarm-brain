import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteDraftMeeting, type DraftDeleteResult } from "../_shared/meeting-delete.ts";

type Args = { meeting_id: string; requesting_user_id?: number };
type Dependencies = {
  remove: (id: string, callerId: number) => Promise<DraftDeleteResult>;
};

/** Identity was injected by the existing MCP authorization/confirmation boundary. */
export async function deleteDraftMeetingTool(args: Args, deps: Dependencies): Promise<string> {
  if (!args.requesting_user_id) return "Ошибка: личность не определена (нужен токен коннектора).";
  const result = await deps.remove(args.meeting_id, args.requesting_user_id);
  if (result.ok) return "✅ Черновик и первичные файлы удалены.";
  switch (result.reason) {
    case "not_found":
      return "Черновик не найден.";
    case "published":
      return "Уже опубликовано — правь запись в базе (update_entry).";
    case "shared":
      return "Черновик с несколькими владельцами можно скрыть у себя в вебе.";
    case "forbidden":
      return "Ошибка: нельзя удалить этот черновик.";
    case "changed":
      return "Черновик изменился. Проверь его перед повторным удалением.";
    case "storage":
      return "Удаление первичных файлов не завершено. Повтори удаление с тем же meeting_id.";
    case "database":
      return "Ошибка: не удалось завершить удаление черновика.";
  }
}

/** Match the web caller's current workspace-admin/master flags without accepting identity args. */
export async function deleteDraftMeetingAsCaller(
  sb: SupabaseClient,
  id: string,
  callerId: number,
  groupId: string,
  isMaster: boolean,
  remove: typeof deleteDraftMeeting = deleteDraftMeeting,
): Promise<DraftDeleteResult> {
  const { data, error } = await sb.from("allowed_users").select("email,is_admin")
    .eq("telegram_id", callerId).eq("group_id", groupId).maybeSingle();
  if (error) return { ok: false, reason: "database" };
  const row = data as { email?: string | null; is_admin?: boolean } | null;
  if (!row) return { ok: false, reason: "not_found" };
  return await remove(sb, id, {
    telegramId: callerId,
    groupId,
    isAdmin: isMaster || row.is_admin === true,
    email: row.email ?? null,
  });
}
