import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  employeeReport,
  type EmployeeReportArgs,
  type ReportData,
  type ReportDeps,
  type ReportTask,
} from "./employee-report-core.ts";

const args: EmployeeReportArgs = { date_from: "2026-10-19", date_to: "2026-10-25", requesting_user_id: 1 };
function fixture(data: Partial<ReportData> = {}) {
  const calls: unknown[] = [];
  const deps: ReportDeps = {
    caller: (id) => Promise.resolve(id === 1 ? { userId: 1, groupId: "fixture" } : null),
    load: (scope, id, from, until) => {
      calls.push({ scope, id, from, until });
      return Promise.resolve({ employees: [{ id: 2, name: "Fixture Person" }], tasks: [], changes: [], ...data });
    },
    now: () => new Date("2026-11-27T10:00:00Z"),
    denied: "DENIED",
  };
  return { deps, calls };
}
function task(id: string, fields: Partial<ReportTask> = {}): ReportTask {
  return { id, status: "todo", assignee_telegram_ids: [2], created_at: "2026-10-20T12:00:00Z", ...fields };
}

Deno.test("employee report: non-admin denied before loading any employee or task", async () => {
  const f = fixture();
  assertEquals(await employeeReport({ ...args, requesting_user_id: 2 }, f.deps), "DENIED");
  assertEquals(f.calls, []);
});

Deno.test("employee report: strict inclusive dates and bounded periods", async () => {
  for (
    const patch of [
      { date_from: "2026-02-30" },
      { date_to: "2026-10-18" },
      { date_to: "2026-12-01" },
      { date_from: "2026-01-01" },
      { date_from: "2026-10-19T00:00:00Z" },
      { employee_id: 0 },
    ]
  ) {
    const f = fixture();
    assertStringIncludes(await employeeReport({ ...args, ...patch }, f.deps), "Ошибка:");
    assertEquals(f.calls, []);
  }
});

Deno.test("employee report: exact workspace, token identity, employee and exclusive upper bound reach loader", async () => {
  const f = fixture();
  await employeeReport({ ...args, employee_id: 2 }, f.deps);
  assertEquals(f.calls, [{
    scope: { userId: 1, groupId: "fixture" },
    id: 2,
    from: "2026-10-19T00:00:00.000Z",
    until: "2026-10-26T00:00:00.000Z",
  }]);
});

Deno.test("employee report: closed historical window, current backlog, assignees and freeze are separate", async () => {
  const f = fixture({
    tasks: [
      task("start", {
        created_at: "2026-10-19T00:00:00Z",
        status: "done",
        completed_at: "2026-10-25T23:59:59Z",
        due_date: "2026-10-25",
      }),
      task("before", { created_at: "2026-10-18T23:59:59Z", status: "done", completed_at: "2026-10-18T23:59:59Z" }),
      task("after", { created_at: "2026-10-26T00:00:00Z", status: "done", completed_at: "2026-10-26T00:00:00Z" }),
      task("open", { status: "in_progress", due_date: "2026-11-26" }),
      task("due-today", { due_date: "2026-11-27" }),
      task("frozen", { frozen_at: "2026-10-21T00:00:00Z" }),
      task("other", { assignee_telegram_ids: [3] }),
    ],
  });
  const report = await employeeReport(args, f.deps);
  assertStringIncludes(report, "создано 3; закрыто 1; в срок 100% (1 задач со сроком)");
  assertStringIncludes(report, "открыто 2; в работе 1; просрочено 1");
  assertStringIncludes(report, "SWARM-REPORT-SNAPSHOT");
});

Deno.test("employee report: deadline events are scoped to the employee and requested window", async () => {
  const f = fixture({
    tasks: [task("a")],
    changes: [
      { task_id: "a", old_value: "2026-10-20", new_value: "2026-10-25", created_at: "2026-10-20T00:00:00Z" },
      { task_id: "a", old_value: "2026-10-25", new_value: "2026-10-24", created_at: "2026-10-21T00:00:00Z" },
      { task_id: "a", old_value: "2026-10-20", new_value: "2026-10-25", created_at: "2026-10-26T00:00:00Z" },
      { task_id: "other", old_value: "2026-10-20", new_value: "2026-10-25", created_at: "2026-10-20T00:00:00Z" },
    ],
  });
  assertStringIncludes(await employeeReport(args, f.deps), "за период: 2; переносов на более позднюю дату: 1");
});

Deno.test("employee report: no matching workspace employee gives no report", async () => {
  const f = fixture({ employees: [] });
  assertEquals(
    await employeeReport({ ...args, employee_id: 99 }, f.deps),
    "Сотрудник не найден в текущем пространстве.",
  );
});

Deno.test("employee report: failed or incomplete data propagates instead of reporting zeros", async () => {
  const f = fixture();
  f.deps.load = () => Promise.reject(new Error("fixture database failure"));
  let failed = false;
  try {
    await employeeReport(args, f.deps);
  } catch (error) {
    failed = error instanceof Error && error.message === "fixture database failure";
  }
  assertEquals(failed, true);
});
