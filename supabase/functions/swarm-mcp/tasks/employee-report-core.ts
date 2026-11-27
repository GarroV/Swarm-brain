import { computeTaskStats, type StatsTask } from "../../_shared/tasks/analytics.ts";
import { isTaskFrozen } from "../../_shared/tasks/frozen.ts";

export interface EmployeeReportArgs {
  date_from: string;
  date_to: string;
  employee_id?: number;
  requesting_user_id: number;
}
export type ReportTask = StatsTask & { assignee_telegram_ids: number[] | null };
export type DeadlineChange = {
  task_id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};
export interface ReportData {
  employees: Array<{ id: number; name: string }>;
  tasks: ReportTask[];
  changes: DeadlineChange[];
}
export interface ReportDeps {
  caller: (id: number) => Promise<{ userId: number; groupId: string } | null>;
  load: (
    scope: { userId: number; groupId: string },
    employeeId: number | undefined,
    from: string,
    until: string,
  ) => Promise<ReportData>;
  now: () => Date;
  denied: string;
}

function dateBoundary(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

/** A report is a response only: no entry, attachment, or outbound message is created. */
export async function employeeReport(args: EmployeeReportArgs, deps: ReportDeps): Promise<string> {
  const scope = await deps.caller(args.requesting_user_id);
  if (!scope) return deps.denied;
  const from = dateBoundary(args.date_from), end = dateBoundary(args.date_to);
  const now = deps.now();
  if (from === null || end === null || end < from || end - from >= 92 * 86_400_000 || end > now.getTime()) {
    return "Ошибка: нужны date_from и date_to в формате YYYY-MM-DD, от 1 до 92 дней, без будущих дат.";
  }
  if (args.employee_id !== undefined && (!Number.isSafeInteger(args.employee_id) || args.employee_id === 0)) {
    return "Ошибка: employee_id должен быть внутренним ID сотрудника из get_users.";
  }
  const until = end + 86_400_000;
  const fromISO = new Date(from).toISOString(), untilISO = new Date(until).toISOString();
  const data = await deps.load(scope, args.employee_id, fromISO, untilISO);
  if (!data.employees.length) return "Сотрудник не найден в текущем пространстве.";
  const within = (date: string | null | undefined): boolean => {
    const ms = date ? Date.parse(date) : NaN;
    return ms >= from && ms < until && ms <= now.getTime();
  };
  const lines = [
    `SWARM-REPORT-SNAPSHOT | Отчёт по сотрудникам | ${args.date_from}–${args.date_to} (UTC)`,
    "Конфиденциально. Не сохранять в общую базу и не пересылать команде.",
    `Текущая загрузка — на ${now.toISOString()}. Исполнители — по текущему назначению задач.`,
    "В выборке: подтверждённые неархивные задачи доступных проектов; замороженные исключены.",
    "Сроки — текущие значения; переносы — события журнала за период. Совместная задача учитывается у каждого исполнителя.",
  ];
  for (const employee of data.employees) {
    const tasks = data.tasks.filter((t) =>
      !isTaskFrozen(t) && (t.assignee_telegram_ids ?? []).some((id) => Number(id) === employee.id)
    );
    const stats = computeTaskStats(
      tasks.map((t) => ({
        ...t,
        created_at: within(t.created_at) ? t.created_at : null,
        completed_at: within(t.completed_at) ? t.completed_at : null,
      })),
      { sinceISO: fromISO, now },
    );
    const ids = new Set(tasks.map((t) => t.id));
    const changes = data.changes.filter((c) => ids.has(c.task_id) && within(c.created_at));
    const postponed = changes.filter((c) => c.old_value && c.new_value && c.new_value > c.old_value).length;
    const onTime = stats.onTimeRate === null
      ? "нет данных"
      : `${Math.round(stats.onTimeRate * 100)}% (${stats.onTimeBase} задач со сроком)`;
    lines.push(
      `\n${employee.name.replace(/\s+/g, " ")} (#${employee.id})`,
      `За период: создано ${stats.createdInPeriod}; закрыто ${stats.closedInPeriod}; в срок ${onTime}.`,
      `Сейчас: открыто ${stats.openNow}; в работе ${stats.inProgressNow}; просрочено ${stats.overdueNow}.`,
      `Изменений срока за период: ${changes.length}; переносов на более позднюю дату: ${postponed}.`,
    );
  }
  return lines.join("\n");
}
