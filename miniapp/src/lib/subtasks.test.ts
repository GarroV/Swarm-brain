import { assertEquals } from "jsr:@std/assert";
import { nestSubtasks, progressByParent, subtaskCandidates, subtasksOf } from "./subtasks.ts";
import type { Task } from "../types.ts";

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

const ALL = [
  task({ id: "A" }),
  task({ id: "a1", parent_id: "A" }),
  task({ id: "a2", parent_id: "A", status: "done" }),
  task({ id: "B" }),
  task({ id: "C", project_id: "p2" }),
  task({ id: "D", status: "done" }),
];

Deno.test("subtasksOf: только прямые дети", () => {
  assertEquals(subtasksOf(ALL, "A").map((t) => t.id), ["a1", "a2"]);
});

Deno.test("subtaskCandidates: тот же проект, без родителя, без своих подзадач, не закрытая, не сама", () => {
  const b = ALL.find((t) => t.id === "B")!;
  // A — родитель (есть дети), a1 — уже подзадача, C — другой проект, D — закрыта, B — сама
  assertEquals(subtaskCandidates(ALL, b).map((t) => t.id), []);
  const e = task({ id: "E" });
  assertEquals(subtaskCandidates([...ALL, e], b).map((t) => t.id), ["E"]);
});

Deno.test("progressByParent: считает закрытые из всех", () => {
  assertEquals(progressByParent(ALL).get("A"), { done: 1, total: 2 });
  assertEquals(progressByParent(ALL).get("B"), undefined);
});

Deno.test("nestSubtasks: дети идут сразу под родителем; сирота без родителя в срезе — на верхнем уровне", () => {
  const rows = nestSubtasks([ALL[1], ALL[3], ALL[0], ALL[2]]);
  assertEquals(rows.map((r) => `${r.depth}:${r.task.id}`), ["0:B", "0:A", "1:a1", "1:a2"]);
  const orphan = nestSubtasks([ALL[1], ALL[3]]);
  assertEquals(orphan.map((r) => `${r.depth}:${r.task.id}`), ["0:a1", "0:B"]);
});
