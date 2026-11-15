import { assertEquals } from "@std/assert";
import type { Me, SprintCycleItem, Task } from "../types.ts";
import { countLists, filterTasks, isOverdue, isTaskFrozen } from "./smartLists.ts";
import { computeProgress, sprintKpi } from "./initiatives.ts";
import { currentRank, dueBucket, groupByDue } from "./taskTable.ts";
import { groupHome, nextHomeTasks } from "./homeTasks.ts";
import { whatsNext } from "./taskCalendar.ts";
import { countMyOverdue } from "./navBadges.ts";

const now = new Date("2026-11-14T12:00:00Z");
const me = { telegram_id: 814 } as Me;
const task = (over: Partial<Task> = {}) => ({
  id: "fictional", title: "Fictional task", status: "open", project_id: null,
  assignees: ["Fictional Person"], assignee_telegram_ids: [814], due_date: "2026-11-01",
  frozen_at: "2026-11-10T12:00:00Z", recur_freq: "weekly", ...over,
} as Task);

Deno.test("814 frozen task stays in normal lists and the independent Frozen selection", () => {
  const frozen = task();
  const active = task({ id: "active", frozen_at: null });
  assertEquals(filterTasks([frozen, active], "all", "mine", me, now).map((t) => t.id), ["fictional", "active"]);
  assertEquals(filterTasks([frozen, active], "frozen", "mine", me, now).map((t) => t.id), ["fictional"]);
  assertEquals(countLists([frozen, active], "mine", me, now).frozen, 1);
  assertEquals(filterTasks([frozen], "recurring", "mine", me, now).length, 1);
  assertEquals(isTaskFrozen({}), false);
});

Deno.test("814 frozen dates cannot be overdue/current, but the row remains visibly grouped", () => {
  const frozen = task();
  assertEquals([isOverdue(frozen, now), countMyOverdue([frozen], me, now)], [false, 0]);
  assertEquals([dueBucket(frozen, now), currentRank(frozen, now)], ["frozen", null]);
  assertEquals(groupByDue([frozen], now, 1).map((s) => [s.key, s.tasks.length]), [["frozen", 1]]);
  assertEquals(groupHome([frozen], now, 1).map((s) => [s.key, s.tasks.length]), [["frozen", 1]]);
  assertEquals(nextHomeTasks([frozen], now), []);
  assertEquals(whatsNext([frozen], []).soon, []);
  assertEquals(isOverdue(task({ frozen_at: null }), now), true);
});

Deno.test("814 task and snapshot flags exclude progress and review without hiding board rows", () => {
  const done = { id: "done", status: "done", project_id: null };
  assertEquals(computeProgress([done, task()]), { total: 1, done: 1, percent: 100 });
  const held = { id: "held", status: "open", project_id: null, task_frozen: true, check_status: "risk", assignees: [] } as unknown as SprintCycleItem;
  const kpi = sprintKpi([held]);
  assertEquals([kpi.total, kpi.checkRisk, kpi.unchecked, kpi.unassigned], [0, 0, 0, 0]);
  assertEquals(computeProgress([{ ...held, task_frozen: false }]).total, 1);
});

Deno.test("814 board attention predicates do not classify paused work as a risk or overdue", async () => {
  const { itemNeedsAttention, planTaskNeedsAttention } = await import("../components/tasks/sprints/board/boardModel.ts");
  const item = { status: "open", task_frozen: true, due_date: "2000-01-01", check_status: "risk", removed: false } as SprintCycleItem;
  assertEquals(itemNeedsAttention(item), false);
  const plan = { status: "open", due_date: "2000-01-01", frozen_at: "2026-11-10T12:00:00Z" } as unknown as import("../types.ts").BoardPlanTask;
  assertEquals(planTaskNeedsAttention(plan), false);
});

Deno.test("814 current review reminder excludes frozen items; carry reason history remains visible", async () => {
  const { checkpointReminder, hotTasks } = await import("./homeNews.ts");
  const { buildSpaceReport } = await import("./spaceAnalytics.ts");
  const held = { id: "held", task_id: "fictional", title: "Fictional task", status: "open", in_plan: true,
    assignees: [], project_id: null, task_frozen: true, check_status: null, carry_count: 2,
    carry_reason: "Fictional reason", removed: false } as unknown as SprintCycleItem;
  const cycle = { id: "fictional-cycle", name: "Fictional cycle", status: "active", check_date: "2026-11-14", end_date: "2026-11-20" } as import("../types.ts").SprintCycle;
  assertEquals(hotTasks([task()], now), []);
  assertEquals(checkpointReminder([{ cycle, items: [held] }], new Set(["fictional"]), now), null);
  assertEquals(checkpointReminder([{ cycle, items: [{ ...held, task_frozen: false }] }], new Set(["fictional"]), now)?.pending, 1);
  const report = buildSpaceReport({ cycles: [], current: { ...cycle, items: [held], withdrawn: [] } as unknown as import("../types.ts").SprintCycleDetail, projects: [], tasks: [task()], today: now });
  assertEquals([report.current?.total, report.current?.unchecked, report.people.length], [0, 0, 0]);
  assertEquals(report.carries, [{ title: "Fictional task", reason: "Fictional reason", count: 2 }]);
});
