// Исполнитель по telegram_id для веба: назначить можно только члена воркспейса задачи.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function resolveAssigneeInWorkspace(
  supabase: Pick<SupabaseClient, "from">,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
  telegramId: number,
  groupId: string,
): Promise<{ telegram_id: number; name: string } | null> {
  const { data: au } = await supabase
    .from("allowed_users").select("telegram_id").eq("telegram_id", telegramId)
    .eq("group_id", groupId).maybeSingle();
  if (!au) return null; // не член этого воркспейса — не назначаем
  const name = (await resolveNames([telegramId])).get(telegramId) ?? String(telegramId);
  return { telegram_id: telegramId, name };
}
