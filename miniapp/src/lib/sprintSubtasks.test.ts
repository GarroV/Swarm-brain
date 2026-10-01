import { assertEquals } from "jsr:@std/assert";
import { sprintRows } from "./sprintSubtasks.ts";
import type { Task } from "../types.ts";

type Item = { id: string; task_id: string | null };

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id, assignees: [], assignee_telegram_ids: [],
    due_date: null, remind_date: null, reminded_at: null,
    country: null, priority: null, status: "open",
    created_at: "2026-09-01T10:00:00+00:00", updated_at: null,
    meeting_id: null, created_by_name: null, is_private: false,
    start_date: null, sprint_id: null, label_ids: [], project_id: "p1",
    project_linked: false, parent_id: null, tree_x: null, tree_y: null,
    recur_freq: null, recur_anchor_dom: null,
    ...over,
  } as Task;
}

const tasks = [
  task({ id: "P" }),
  task({ id: "s1", parent_id: "P", status: "done" }),
  task({ id: "s2", parent_id: "P" }),
  task({ id: "s3", parent_id: "P" }),
  task({ id: "X" }),
  task({ id: "orphan", parent_id: "Q" }),
  task({ id: "Q", title: "Родитель вне группы" }),
];
const it = (task_id: string): Item => ({ id: `i-${task_id}`, task_id });
const group = [it("P"), it("s2"), it("X"), it("orphan")];
const sprintTaskIds = new Set(["P", "s2", "s3", "X", "orphan"]);
const base = {
  idOf: (i: Item) => i.task_id,
  parentOf: (i: Item) => tasks.find((t) => t.id === i.task_id)?.parent_id ?? null,
  tasks,
  sprintTaskIds,
};
const shape = (rows: ReturnType<typeof sprintRows<Item>>) =>
  rows.map((r) => r.kind === "item" ? `${"  ".repeat(r.depth)}${r.item.task_id}` : `  ~${r.task.id}${r.inSprint ? "+" : "-"}`);

Deno.test("свёрнутый родитель прячет подзадачи, но несёт счётчик готово/всего", () => {
  const rows = sprintRows(group, { ...base, isOpen: () => false });
  assertEquals(shape(rows), ["P", "X", "orphan"]);
  const p = rows[0];
  assertEquals(p.kind === "item" ? p.kids : null, { taskId: "P", done: 1, total: 3 });
});

Deno.test("развёрнутый родитель: своя строка состава полной строкой, остальные — лёгкие с пометкой спринта", () => {
  const rows = sprintRows(group, { ...base, isOpen: (id) => id === "P" });
  assertEquals(shape(rows), ["P", "  ~s1-", "  s2", "  ~s3+", "X", "orphan"]);
});

Deno.test("строка состава рисуется ровно один раз", () => {
  const rows = sprintRows(group, { ...base, isOpen: () => true });
  const items = rows.filter((r) => r.kind === "item").map((r) => r.kind === "item" ? r.item.id : "");
  assertEquals(new Set(items).size, items.length);
  assertEquals(items.length, group.length);
});

Deno.test("подзадача, чей родитель вне группы, — на верхнем уровне с подписью родителя", () => {
  const rows = sprintRows(group, { ...base, isOpen: () => false });
  const o = rows.find((r) => r.kind === "item" && r.item.task_id === "orphan");
  assertEquals(o?.kind === "item" ? o.parent : null, { id: "Q", title: "Родитель вне группы" });
});

Deno.test("задача без подзадач — без шеврона", () => {
  const rows = sprintRows(group, { ...base, isOpen: () => true });
  const x = rows.find((r) => r.kind === "item" && r.item.task_id === "X");
  assertEquals(x?.kind === "item" ? x.kids : "missing", undefined);
});
