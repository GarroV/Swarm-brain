import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { MeetingViewer } from "../../_shared/entries/meeting-rights.ts";
import { masterAdminFlag } from "../../_shared/users/master-admins.ts";

export const ADMIN_USER_ID = 744230399;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Мастер-админ по данным (#233): константа ADMIN_USER_ID ИЛИ строка master_admins. Для решений о
 * правах; адресат тревог админу — по-прежнему ADMIN_USER_ID.
 */
export function isMasterUser(telegramId: number): Promise<boolean> {
  return masterAdminFlag(supabase, telegramId);
}

// Единый признак админа: мастер-админ (ADMIN_USER_ID, fail-safe, ЛИБО строка master_admins)
// ЛИБО флаг allowed_users.is_admin (руководитель — «видит ВСЁ»). Тот же смысл, что isAdmin в swarm-api.
export async function isAdminUser(telegramId: number): Promise<boolean> {
  if (await isMasterUser(telegramId)) return true;
  const { data } = await supabase
    .from("allowed_users")
    .select("is_admin")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return (data as { is_admin?: boolean } | null)?.is_admin === true;
}

// Кто действует над встречей: админ ли он и его e-mail (для причастности к встрече).
// Тот же признак админа, что в isAdminUser и swarm-api; строки нет — ни прав админа, ни e-mail.
export async function loadMeetingViewer(viewerId: number): Promise<MeetingViewer> {
  const { data } = await supabase
    .from("allowed_users")
    .select("is_admin, email")
    .eq("telegram_id", viewerId)
    .maybeSingle();
  const row = data as { is_admin?: boolean; email?: string | null } | null;
  return {
    id: viewerId,
    email: row?.email ?? null,
    isAdmin: (await isMasterUser(viewerId)) || row?.is_admin === true,
  };
}
