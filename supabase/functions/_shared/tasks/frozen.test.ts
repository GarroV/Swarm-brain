import { assertEquals } from "@std/assert";
import { freezeExpectation, freezeTaskUpdate, isTaskFrozen } from "./frozen.ts";
import { computeFlowTimes, computeTaskStats } from "./analytics.ts";
import { countProjectTasks } from "./project-counts.ts";
import { computeSprintStats } from "./sprint-stats.ts";
import { computePeopleStats } from "../stats/people.ts";
import type { Task } from "./types.ts";

const now = new Date("2026-11-14T12:00:00Z");
const sinceISO = "2026-11-01T00:00:00Z";
const held = {
  id: "fictional-held",
  status: "open",
  due_date: "2026-11-01",
  created_at: sinceISO,
  frozen_at: "2026-11-10T12:00:00Z",
  frozen_by: 814,
  group_id: "fictional",
  project_id: "fictional-project",
  assignees: ["Fictional Person"],
  assignee_telegram_ids: [814],
};

Deno.test("814 freeze detection keeps legacy live/snapshot rows active", () => {
  assertEquals([isTaskFrozen({}), isTaskFrozen({ frozen_at: null }), isTaskFrozen({ task_frozen: false })], [
    false,
    false,
    false,
  ]);
  assertEquals([isTaskFrozen(held), isTaskFrozen({ task_frozen: true })], [true, true]);
});

Deno.test("814 frozen task contributes no workload, percentages, timeliness or flow basis", () => {
  const stats = computeTaskStats([held], { sinceISO, now });
  assertEquals([stats.createdInPeriod, stats.openNow, stats.overdueNow, stats.onTimeBase], [0, 0, 0, 0]);
  assertEquals(stats.createdByBucket, []);
  assertEquals(countProjectTasks([held]).size, 0);
  assertEquals(
    computeFlowTimes([{ task_id: held.id, new_value: "in_progress", created_at: sinceISO }], [held]).basis,
    0,
  );
  const active = { ...held, frozen_at: null };
  assertEquals(computeTaskStats([active], { sinceISO, now }).overdueNow, 1);
  assertEquals(countProjectTasks([active]).get(held.project_id), { total: 1, backlog: 0 });
});

Deno.test("814 person statistics exclude frozen work but retain ordinary tasks", () => {
  const stats = computePeopleStats({
    members: [{ telegram_id: 814, name: "Fictional Person" }],
    tasks: [held],
    meetings: [],
    reviewCounts: null,
    events: [],
    now,
  });
  assertEquals([stats[0].tasks.open, stats[0].tasks.overdue], [0, 0]);
});

Deno.test("814 frozen sprint task is outside progress/review while carried is the actual unchanged transfer", () => {
  const done = {
    in_plan: true,
    status: "done",
    assignees: [],
    project: null,
    completed_at: sinceISO,
    check_status: "ok",
  };
  const frozen = { ...done, status: "open", completed_at: null, task_frozen: true, check_status: "risk" };
  const stats = computeSprintStats([done, frozen]);
  assertEquals([stats.plan, stats.planPercent, stats.check_risk, stats.unassigned], [1, 100, 0, 1]);
  assertEquals([stats.carried, stats.carried_auto], [1, 1]);
  assertEquals(computeSprintStats([{ ...frozen, task_frozen: false }]).plan, 1);
  assertEquals(computeSprintStats([{ ...frozen, withdrawn_at: sinceISO }]).plan, 0);
});

Deno.test("814 freeze/unfreeze patch journals only pause fields and leaves recurrence/status/dates intact", () => {
  const task = {
    ...held,
    frozen_at: null,
    frozen_by: null,
    recur_freq: "weekly",
    due_date: "2026-11-20",
  } as unknown as Task;
  const before = structuredClone(task);
  const input = freezeTaskUpdate(task, true, 814, now.toISOString())!;
  assertEquals(Object.keys(input.p_patch).sort(), ["frozen_at", "frozen_by", "updated_at"]);
  assertEquals(input.p_expect, {
    group_id: "fictional",
    project_id: held.project_id,
    archived_at: null,
    frozen_at: null,
    frozen_by: null,
  });
  assertEquals(input.p_history.map((h) => h.field).sort(), ["frozen_at", "frozen_by"]);
  assertEquals(task, before);
  assertEquals(freezeTaskUpdate({ ...task, frozen_at: sinceISO, frozen_by: 814 }, true, 815, now.toISOString()), null);
  assertEquals(freezeTaskUpdate(task, false, 814, now.toISOString()), null);
  const back = freezeTaskUpdate({ ...task, frozen_at: sinceISO, frozen_by: 814 }, false, 814, now.toISOString())!;
  assertEquals(back.p_patch, { frozen_at: null, frozen_by: null, updated_at: now.toISOString() });
});

Deno.test("814 acceptance expectation includes live withdrawn rows, never current flags of immutable/moved/removed rows", () => {
  assertEquals(
    freezeExpectation([
      { task_id: "live", task_frozen: true },
      { task_id: "withdrawn", task_frozen: false, withdrawn_at: sinceISO },
      { task_id: "snapshot", task_frozen: false, frozen: true },
      { task_id: "moved", task_frozen: false, moved: { at: sinceISO } },
      { task_id: "removed", task_frozen: true, removed: true },
      { task_id: null, task_frozen: true },
    ]),
    { live: true, withdrawn: false },
  );
});
