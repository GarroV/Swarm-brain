import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ADMIN_USER_ID = 744230399;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Единый признак админа: зашитый суперадмин-разработчик (ADMIN_USER_ID, fail-safe)
// ЛИБО флаг allowed_users.is_admin (руководитель — «видит ВСЁ»). Тот же смысл, что isAdmin в swarm-api.
export async function isAdminUser(telegramId: number): Promise<boolean> {
  if (telegramId === ADMIN_USER_ID) return true;
  const { data } = await supabase
    .from("allowed_users")
    .select("is_admin")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return (data as { is_admin?: boolean } | null)?.is_admin === true;
}
