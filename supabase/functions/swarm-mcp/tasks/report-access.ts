import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { masterAdminFlag } from "../../_shared/users/master-admins.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const REPORT_ACCESS_DENIED = "Нет доступа: отчёты по сотрудникам доступны только администраторам пространства.";
export const isAdminReportTool = (name: string): boolean => name === "get_employee_report" || name === "get_task_stats";

/** Identity comes from the verified MCP token; never accept a role from tool arguments. */
export async function reportCaller(userId: number): Promise<{ userId: number; groupId: string } | null> {
  if (!Number.isSafeInteger(userId) || userId === 0) return null;
  const { data, error } = await supabase.from("allowed_users").select("group_id,is_admin")
    .eq("telegram_id", userId).maybeSingle();
  if (error) throw new Error("Cannot verify report access");
  if (!data?.group_id) return null;
  if (data.is_admin !== true && !(await masterAdminFlag(supabase, userId))) return null;
  return { userId, groupId: data.group_id };
}
