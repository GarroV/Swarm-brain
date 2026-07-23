import { supabase, ADMIN_USER_ID } from "./supabase.ts";
import { addUserToWorkspace } from "../../_shared/users/membership.ts";

export async function getUserGroupId(userId: number): Promise<string | null> {
  const { data } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", userId)
    .maybeSingle();
  return data?.group_id ?? null;
}

export async function checkAllowedWithGroup(
  userId: number,
  username?: string,
): Promise<{ allowed: boolean; groupId: string }> {
  // Superadmin bypass
  if (userId === ADMIN_USER_ID) {
    const { data } = await supabase
      .from("allowed_users")
      .select("group_id")
      .eq("telegram_id", userId)
      .maybeSingle();
    return { allowed: true, groupId: data?.group_id ?? "" };
  }

  // Look up the user row (includes superadmin who is now in allowed_users after backfill)
  const { data } = await supabase
    .from("allowed_users")
    .select("telegram_id, group_id")
    .eq("telegram_id", userId)
    .maybeSingle();

  if (data) {
    if (!data.group_id) return { allowed: false, groupId: "" };
    return { allowed: true, groupId: data.group_id };
  }

  // No row found — try username pending-invite resolution
  if (username) {
    const { data: pending } = await supabase
      .from("allowed_users")
      .select("id, group_id")
      .eq("username", username)
      .is("telegram_id", null)
      .limit(1);
    const row = pending?.[0];
    if (row) {
      await supabase.from("allowed_users")
        .update({ telegram_id: userId })
        .eq("id", row.id);
      if (!row.group_id) return { allowed: false, groupId: "" };
      return { allowed: true, groupId: row.group_id };
    }
  }

  return { allowed: false, groupId: "" };
}

// Рынки воркспейса (allowed_markets) — для пикера стран у встречи при вычитке.
// null → рынки не заданы (вызывающий подставляет полный список COUNTRY_NAMES).
export async function getWorkspaceMarkets(groupId: string): Promise<string[] | null> {
  if (!groupId) return null;
  const { data } = await supabase
    .from("workspaces")
    .select("allowed_markets")
    .eq("id", groupId)
    .maybeSingle();
  const markets = (data as { allowed_markets?: string[] } | null)?.allowed_markets;
  return markets?.length ? markets : null;
}

// Workspace management (superadmin only)

export async function listWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at");
  return (data ?? []) as Array<{ id: string; name: string }>;
}

export async function createWorkspace(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("workspaces").insert({ id, name });
  if (error) throw new Error(error.message);
}

// Тонкая обёртка над каноном `_shared/users/membership.ts` (единая логика для бота и веба).
// Сигнатуру и строковый результат сохраняем — существующие вызовы (superadmin/workspace) не трогаем.
export async function assignUserToWorkspace(
  telegramId: number | null,
  username: string | null,
  workspaceId: string,
): Promise<"ok" | "not_found" | "workspace_not_found"> {
  const r = await addUserToWorkspace(supabase, { telegramId, username, workspaceId, addedBy: ADMIN_USER_ID });
  return r.status === "bad_input" ? "not_found" : r.status;
}
