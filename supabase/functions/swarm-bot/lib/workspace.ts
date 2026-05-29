import { supabase, ADMIN_USER_ID } from "./supabase.ts";

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

export async function assignUserToWorkspace(
  telegramId: number | null,
  username: string | null,
  workspaceId: string,
): Promise<"ok" | "not_found" | "workspace_not_found"> {
  // Verify workspace exists
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (wsErr) throw new Error(wsErr.message);
  if (!ws) return "workspace_not_found";

  if (telegramId !== null) {
    const { data: existing } = await supabase
      .from("allowed_users").select("id").eq("telegram_id", telegramId).maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("allowed_users")
        .update({ group_id: workspaceId })
        .eq("telegram_id", telegramId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("allowed_users")
        .insert({ telegram_id: telegramId, group_id: workspaceId, added_by: ADMIN_USER_ID });
      if (error) throw new Error(error.message);
    }
    return "ok";
  }

  if (username) {
    // May already be pending (no telegram_id yet)
    const { data: existing } = await supabase
      .from("allowed_users").select("id").eq("username", username).maybeSingle();
    if (existing) {
      const { error } = await supabase.from("allowed_users").update({ group_id: workspaceId }).eq("username", username);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("allowed_users").insert({ username, group_id: workspaceId, added_by: ADMIN_USER_ID });
      if (error) throw new Error(error.message);
    }
    return "ok";
  }

  return "not_found";
}
