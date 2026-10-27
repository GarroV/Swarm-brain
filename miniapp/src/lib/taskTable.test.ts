import { assertEquals } from "jsr:@std/assert";
import { dueBucket, groupByDue, groupByPerson } from "./taskTable.ts";
import type { Task, User } from "../types.ts";

const NOW = new Date(2026, 8, 24, 12, 0, 0); // 24.09.2026, полдень

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: "T", assignees: [], assignee_telegram_ids: [],
    due_date: null, remind_date: null, reminded_at: null,
    country: null, priority: null, status: "open",
    created_at: "2026-09-01T10:00:00+00:00", updated_at: null,
    meeting_id: null, created_by_name: null,
    start_date: null, sprint_id: null, label_ids: [], project_id: null,
    project_linked: false, parent_id: null, tree_x: null, tree_y: null,
    recur_freq: null, recur_anchor_dom: null,
    ...over,
  } as Task;
}

const USERS: User[] = [
  { telegram_id: 1, name: "Аня", username: null, role: null, markets: [] },
  { telegram_id: 2, name: "Борис", username: null, role: null, markets: [] },
];

Deno.test("dueBucket: вчера — просрочено, сегодня — сегодня, завтра — дальше, без срока отдельно", () => {
  assertEquals(dueBucket(task({ id: "a", due_date: "2026-09-23" }), NOW), "over");
  assertEquals(dueBucket(task({ id: "b", due_date: "2026-09-24" }), NOW), "today");
  assertEquals(dueBucket(task({ id: "c", due_date: "2026-09-25" }), NOW), "later");
  assertEquals(dueBucket(task({ id: "d" }), NOW), "nodue");
});

Deno.test("dueBucket: завершённая с прошедшим сроком — «сделано», а не «просрочено»", () => {
  assertEquals(dueBucket(task({ id: "a", due_date: "2026-09-01", status: "done" }), NOW), "done");
});

Deno.test("groupByDue: секции в фиксированном порядке, пустых нет", () => {
  const got = groupByDue([
    task({ id: "later", due_date: "2026-10-01" }),
    task({ id: "over", due_date: "2026-09-20" }),
    task({ id: "done", status: "done" }),
  ], NOW, 0);
  assertEquals(got.map((s) => s.key), ["today", "later", "done"]);
  assertEquals(got[0].label, "Актуальное");
});

// 27.10.2026: «Актуальное» — просрочка, сегодня, завтра и задачи с пингом на сегодня/завтра.
Deno.test("groupByDue: завтрашние и с пингом на сегодня/завтра — в «Актуальном», по порядку", () => {
  const got = groupByDue([
    task({ id: "ping-today", due_date: "2026-09-30", remind_date: "2026-09-24" }),
    task({ id: "tomorrow", due_date: "2026-09-25" }),
    task({ id: "ping-nodue", remind_date: "2026-09-25" }),
    task({ id: "over", due_date: "2026-09-20" }),
    task({ id: "today", due_date: NOW.toISOString() }),
    task({ id: "later", due_date: "2026-09-26" }),
    task({ id: "ping-later", due_date: "2026-10-01", remind_date: "2026-09-26" }),
    task({ id: "ping-past", due_date: "2026-10-01", remind_date: "2026-09-23" }),
  ], NOW, 0);
  assertEquals(got.map((s) => s.key), ["today", "later"]);
  assertEquals(got[0].tasks.map((t) => t.id), ["over", "today", "tomorrow", "ping-today", "ping-nodue"]);
  assertEquals(got[0].late, 1);
  assertEquals(got[1].tasks.map((t) => t.id), ["later", "ping-later", "ping-past"]);
});

Deno.test("groupByDue: сделанная задача с пингом сегодня в «Актуальное» не попадает", () => {
  const got = groupByDue([task({ id: "d", status: "done", remind_date: "2026-09-24" })], NOW, 0);
  assertEquals(got.map((s) => s.key), ["done"]);
});

Deno.test("groupByDue: просроченные и сегодняшние — одна секция «Актуальное», просроченные сверху", () => {
  const got = groupByDue([
    task({ id: "today", due_date: NOW.toISOString() }),
    task({ id: "over", due_date: "2026-09-20" }),
    task({ id: "later", due_date: "2026-10-01" }),
  ], NOW, 0);
  assertEquals(got.map((s) => s.key), ["today", "later"]);
  assertEquals(got[0].tasks.map((t) => t.id), ["over", "today"]);
  assertEquals(got[0].late, 1);
});

Deno.test("groupByPerson: заваленные сверху, «не назначен» последним, двое исполнителей — в обеих группах", () => {
  const got = groupByPerson([
    task({ id: "x", assignee_telegram_ids: [1] }),
    task({ id: "y", assignee_telegram_ids: [2], due_date: "2026-09-01" }),
    task({ id: "z", assignee_telegram_ids: [2, 1] }),
    task({ id: "w", assignee_telegram_ids: [2] }),
    task({ id: "n" }),
  ], USERS, NOW, "не назначен");
  assertEquals(got.map((s) => s.label), ["Борис", "Аня", "не назначен"]);
  assertEquals(got[0].tasks.map((t) => t.id), ["y", "z", "w"]);
  assertEquals(got[0].late, 1);
  assertEquals(got[1].tasks.map((t) => t.id), ["x", "z"]);
});

Deno.test("groupByPerson: исполнителя нет в списке пользователей — имя берётся из задачи", () => {
  const got = groupByPerson([task({ id: "a", assignee_telegram_ids: [9], assignees: ["Вера"] })], USERS, NOW, "—");
  assertEquals(got[0].label, "Вера");
});
