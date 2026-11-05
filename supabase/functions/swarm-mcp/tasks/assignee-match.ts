// Подбор исполнителя по имени среди людей ВОРКСПЕЙСА вызывающего: кандидаты — только члены
// allowed_users с этим group_id. Человек из другого воркспейса не находится, даже если имя совпало.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { personLabel } from "../../_shared/users/display-name.ts";

type Db = Pick<SupabaseClient, "from">;

type Candidate = {
  telegram_id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  name_aliases?: string[];
};

export async function matchAssigneeInWorkspace(
  db: Db,
  name: string,
  groupId: string | null,
): Promise<{ telegram_id: number; display_name: string } | null> {
  if (!groupId) return null;
  // username — в allowed_users (НЕ в user_profiles): селект username из user_profiles падает.
  const { data: aus } = await db
    .from("allowed_users").select("telegram_id, username").eq("group_id", groupId);
  const members = ((aus ?? []) as Array<{ telegram_id: number | null; username?: string | null }>)
    .filter((u): u is { telegram_id: number; username?: string | null } => u.telegram_id != null);
  if (!members.length) return null;
  const { data: profs } = await db
    .from("user_profiles").select("telegram_id, first_name, last_name, email, name_aliases")
    .in("telegram_id", members.map((m) => m.telegram_id));
  if (!profs?.length) return null;
  const uname = new Map<number, string>();
  members.forEach((u) => {
    if (u.username) uname.set(u.telegram_id, u.username);
  });
  const data: Candidate[] = (profs as Candidate[]).map((p) => ({ ...p, username: uname.get(p.telegram_id) }));
  const lower = name.toLowerCase();
  const match = data.find((p) => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
    const un = (p.username ?? "").toLowerCase();
    const email = (p.email ?? "").toLowerCase();
    const aliases = (p.name_aliases ?? []).map((a: string) => a.toLowerCase());
    return (
      fullName.includes(lower) || lower.includes(fullName) ||
      un.includes(lower) ||
      (email.length > 0 && email.includes(lower)) ||
      aliases.some((a) => a.includes(lower) || lower.includes(a))
    );
  });
  if (!match) return null;
  return {
    telegram_id: match.telegram_id,
    // username без «@», как было; дальше — e-mail, а не номер (#537).
    display_name: personLabel(match, match.telegram_id, { usernamePrefix: "" }),
  };
}
