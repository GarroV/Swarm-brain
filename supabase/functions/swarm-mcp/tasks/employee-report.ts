import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { keepVisibleTasks } from "../../_shared/tasks/project-visibility.ts";
import { resolvePersonNames } from "../../_shared/users/display-name.ts";
import {
  type DeadlineChange,
  employeeReport,
  type EmployeeReportArgs,
  type ReportData,
  type ReportTask,
} from "./employee-report-core.ts";
import { REPORT_ACCESS_DENIED, reportCaller } from "./report-access.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TASK_CAP = 2000, MEMBER_CAP = 200, CHANGE_CAP = 2000;

async function load(
  scope: { userId: number; groupId: string },
  employeeId: number | undefined,
  from: string,
  until: string,
): Promise<ReportData> {
  let members = supabase.from("allowed_users").select("telegram_id", { count: "exact" })
    .eq("group_id", scope.groupId).not("telegram_id", "is", null);
  if (employeeId !== undefined) members = members.eq("telegram_id", employeeId);
  const { data: memberRows, error: memberError, count: memberCount } = await members.order("telegram_id").limit(
    MEMBER_CAP + 1,
  );
  if (memberError || memberCount === null || memberCount > MEMBER_CAP || memberRows?.length !== memberCount) {
    throw new Error("Cannot load complete report member list");
  }
  const ids = (memberRows ?? []).map((r) => Number(r.telegram_id));
  if (!ids.length) return { employees: [], tasks: [], changes: [] };
  const names = await resolvePersonNames(supabase, ids);
  const { data, error, count } = await supabase.from("tasks")
    .select("id,project_id,status,created_at,completed_at,due_date,assignee_telegram_ids,frozen_at", { count: "exact" })
    .eq("group_id", scope.groupId).eq("confirmed", true).is("archived_at", null)
    .overlaps("assignee_telegram_ids", ids).order("id").limit(TASK_CAP + 1);
  if (error || count === null || count > TASK_CAP || data?.length !== count) {
    throw new Error("Cannot load complete report task list");
  }
  const tasks = await keepVisibleTasks(
    (data ?? []) as Array<ReportTask & { project_id: string | null }>,
    scope.groupId,
    scope.userId,
  );
  const changes: DeadlineChange[] = [];
  // Small ID batches keep PostgREST URLs bounded; a cap produces an error, never partial totals.
  for (let offset = 0; offset < tasks.length; offset += 200) {
    const { data: rows, error: historyError, count: historyCount } = await supabase.from("task_history")
      .select("task_id,old_value,new_value,created_at", { count: "exact" }).eq("field", "due_date")
      .in("task_id", tasks.slice(offset, offset + 200).map((t) => t.id))
      .gte("created_at", from).lt("created_at", until).order("id").limit(CHANGE_CAP + 1);
    if (
      historyError || historyCount === null || rows?.length !== historyCount ||
      changes.length + historyCount > CHANGE_CAP
    ) {
      throw new Error("Cannot load complete deadline history");
    }
    changes.push(...(rows ?? []) as DeadlineChange[]);
  }
  return { employees: ids.map((id) => ({ id, name: names.get(id) ?? `#${id}` })), tasks, changes };
}

export const toolGetEmployeeReport = (args: EmployeeReportArgs): Promise<string> =>
  employeeReport(args, { caller: reportCaller, load, now: () => new Date(), denied: REPORT_ACCESS_DENIED });
