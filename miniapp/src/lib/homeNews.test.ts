import { assertEquals } from "jsr:@std/assert";
import { checkpointReminder, freshComments, hotTasks, HOT_LIMIT } from "./homeNews.ts";
import type { SprintCycle, SprintCycleItem, Task } from "../types.ts";
import type { SwarmNotification } from "./api.ts";

const NOW = new Date(2026, 8, 25, 12, 0, 0); // пт 25.09.2026

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: "T", assignees: [], assignee_telegram_ids: [],
    due_date: null, remind_date: null, reminded_at: null,
    country: null, priority: null, status: "open",
    created_at: "2026-09-01T10:00:00+00:00", updated_at: null,
    meeting_id: null, created_by_name: null, is_private: false,
    start_date: null, sprint_id: null, label_ids: [], project_id: null,
    project_linked: false, parent_id: null, tree_x: null, tree_y: null,
    recur_freq: null, recur_anchor_dom: null,
    ...over,
  } as Task;
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

Deno.test("hotTasks: просроченные, сегодня и завтра — по сроку; дальше и закрытые не горят", () => {
  const got = hotTasks([
    task({ id: "later", due_date: "2026-09-28" }),
    task({ id: "tomorrow", due_date: "2026-09-26" }),
    task({ id: "late", due_date: "2026-09-20" }),
    task({ id: "today", due_date: "2026-09-25" }),
    task({ id: "done", due_date: "2026-09-20", status: "done" }),
    task({ id: "nodue" }),
  ], NOW);
  assertEquals(ids(got), ["late", "today", "tomorrow"]);
});

Deno.test("hotTasks: не больше HOT_LIMIT", () => {
  const many = Array.from({ length: HOT_LIMIT + 3 }, (_, i) => task({ id: `t${i}`, due_date: "2026-09-24" }));
  assertEquals(hotTasks(many, NOW).length, HOT_LIMIT);
});

function notif(over: Partial<SwarmNotification> & { id: string }): SwarmNotification {
  return {
    type: "task_comment", task_id: "1", task_title: "T", comment_id: "c", content: "x",
    actor_telegram_id: 2, actor_name: "A", read_at: null, created_at: "2026-09-25T10:00:00Z",
    ...over,
  };
}

Deno.test("freshComments: только непрочитанные комментарии, свежие первыми", () => {
  const got = freshComments([
    notif({ id: "old", created_at: "2026-09-24T10:00:00Z" }),
    notif({ id: "read", read_at: "2026-09-25T11:00:00Z" }),
    notif({ id: "rem", type: "task_reminder" }),
    notif({ id: "new", created_at: "2026-09-25T11:00:00Z" }),
  ]);
  assertEquals(ids(got), ["new", "old"]);
});

function cycle(over: Partial<SprintCycle>): SprintCycle {
  return {
    id: "c1", group_id: "g", name: "Спринт 7", start_date: "2026-09-15", end_date: "2026-10-05",
    tab_id: null, check_date: "2026-09-26", status: "active", created_by: null, started_at: null,
    accepted_at: null, accepted_by: null, summary: null, stats: null, created_at: "2026-09-15T00:00:00Z",
    ...over,
  };
}
function item(over: Partial<SprintCycleItem> & { id: string }): SprintCycleItem {
  return {
    task_id: null, in_plan: true, added_at: "2026-09-15T00:00:00Z", title: "i", status: "open",
    assignees: [], project_id: null, project: null, completed_at: null, due_date: null, frozen: false,
    check_status: null, check_note: null, check_at: null, check_by: null, to_carry: false,
    carry_reason: null, carry_count: 0, carried_manual: null, comment_count: 0, link_count: 0,
    removed: false, removed_at: null, hidden: false,
    ...over,
  } as SprintCycleItem;
}

Deno.test("checkpointReminder: за день до сверки напоминает о моих пунктах без отметки", () => {
  const mine = new Set(["t1", "t2", "t3"]);
  const r = checkpointReminder([{
    cycle: cycle({}),
    items: [
      item({ id: "a", task_id: "t1" }),
      item({ id: "b", task_id: "t2", check_status: "ok" }),
      item({ id: "c", task_id: "t3", status: "done" }),
      item({ id: "d", task_id: "other" }),
      item({ id: "e", task_id: "t1", removed: true }),
    ],
  }], mine, NOW);
  assertEquals(r, { cycleId: "c1", name: "Спринт 7", checkDate: "2026-09-26", pending: 1 });
});

Deno.test("checkpointReminder: рано, после финала, без даты сверки или всё отмечено — молчит", () => {
  const mine = new Set(["t1"]);
  const items = [item({ id: "a", task_id: "t1" })];
  assertEquals(checkpointReminder([{ cycle: cycle({ check_date: "2026-10-01" }), items }], mine, NOW), null);
  assertEquals(checkpointReminder([{ cycle: cycle({ end_date: "2026-09-24", check_date: "2026-09-20" }), items }], mine, NOW), null);
  assertEquals(checkpointReminder([{ cycle: cycle({ check_date: null }), items }], mine, NOW), null);
  assertEquals(checkpointReminder([{ cycle: cycle({ status: "draft" }), items }], mine, NOW), null);
  assertEquals(checkpointReminder([{ cycle: cycle({}), items: [item({ id: "a", task_id: "t1", check_status: "risk" })] }], mine, NOW), null);
});

Deno.test("checkpointReminder: сверка прошла, спринт идёт — напоминание остаётся", () => {
  const r = checkpointReminder([{ cycle: cycle({ check_date: "2026-09-22" }), items: [item({ id: "a", task_id: "t1" })] }], new Set(["t1"]), NOW);
  assertEquals(r?.pending, 1);
});
