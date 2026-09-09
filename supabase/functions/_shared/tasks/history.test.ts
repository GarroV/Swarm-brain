import { assert, assertEquals } from "jsr:@std/assert@1";
import { historyRowsFor, historyValue, TRACKED_FIELDS } from "./history.ts";

Deno.test("historyValue: массив исполнителей — читаемая строка, пустой массив — null", () => {
  assertEquals(historyValue(["Аня", "Вася"]), "Аня, Вася");
  assertEquals(historyValue([]), null);
  assertEquals(historyValue(["", "  "]), null);
});

Deno.test("historyValue: пустая строка и null — одинаково null (иначе «» и null дадут ложное изменение)", () => {
  assertEquals(historyValue(""), null);
  assertEquals(historyValue(null), null);
  assertEquals(historyValue(undefined), null);
});

Deno.test("historyRowsFor: пишет только реально изменившиеся поля", () => {
  const rows = historyRowsFor({
    taskId: "t1",
    snapshot: { status: "open", due_date: "2026-09-10", priority: "high" },
    patch: { status: "in_progress", due_date: "2026-09-10" },
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].field, "status");
  assertEquals([rows[0].old_value, rows[0].new_value], ["open", "in_progress"]);
});

Deno.test("historyRowsFor: у статуса заполнены и старые колонки — прежние читатели не сломаны", () => {
  const [row] = historyRowsFor({
    taskId: "t1",
    snapshot: { status: "open" },
    patch: { status: "done" },
  });
  assertEquals([row.old_status, row.new_status], ["open", "done"]);
});

Deno.test("historyRowsFor: не-статусные поля НЕ пишут old_status/new_status", () => {
  const [row] = historyRowsFor({
    taskId: "t1",
    snapshot: { project_id: "p1" },
    patch: { project_id: "p2" },
  });
  assertEquals(row.field, "project");
  assertEquals([row.old_status, row.new_status], [null, null]);
});

Deno.test("historyRowsFor: несколько полей за один патч — несколько строк", () => {
  const rows = historyRowsFor({
    taskId: "t1",
    snapshot: { status: "open", assignees: ["Аня"], sprint_id: null },
    patch: { status: "in_progress", assignees: ["Вася"], sprint_id: "s1" },
    actor: "vasya", actorTelegramId: 42, groupId: "cee",
  });
  assertEquals(rows.length, 3);
  assertEquals(new Set(rows.map((r) => r.field)), new Set(["status", "assignee", "sprint"]));
  assert(rows.every((r) => r.changed_by_telegram_id === 42 && r.group_id === "cee"));
});

Deno.test("historyRowsFor: без снимка «было» строк не пишем — иначе журнал соврёт про переход", () => {
  assertEquals(historyRowsFor({ taskId: "t1", snapshot: null, patch: { status: "done" } }), []);
});

Deno.test("historyRowsFor: поле вне TRACKED_FIELDS не попадает в журнал", () => {
  assert(!("title" in TRACKED_FIELDS));
  assertEquals(historyRowsFor({ taskId: "t1", snapshot: { title: "A" }, patch: { title: "B" } }), []);
});

Deno.test("historyRowsFor: снятие срока (дата → null) фиксируется как изменение", () => {
  const [row] = historyRowsFor({
    taskId: "t1",
    snapshot: { due_date: "2026-09-10" },
    patch: { due_date: null },
  });
  assertEquals([row.field, row.old_value, row.new_value], ["due_date", "2026-09-10", null]);
});
