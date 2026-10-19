import { assertEquals } from "@std/assert";
import { badgeLabel, countMyOverdue } from "./navBadges.ts";
import type { Task } from "../types.ts";

const NOW = new Date(2026, 9, 12, 12, 0, 0); // 12.10.2026, полдень
const ME = { telegram_id: 1 };

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: "T",
    assignees: [],
    assignee_telegram_ids: [1],
    due_date: null,
    status: "open",
    ...over,
  } as Task;
}

Deno.test("счётчик задач: только мои, открытые и строго просроченные", () => {
  const tasks = [
    task({ id: "late", due_date: "2026-10-10" }),
    task({ id: "today", due_date: "2026-10-12" }),
    task({ id: "future", due_date: "2026-10-20" }),
    task({ id: "nodue" }),
    task({ id: "done", due_date: "2026-10-01", status: "done" }),
    task({ id: "other", due_date: "2026-10-01", assignee_telegram_ids: [2] }),
    task({ id: "team", due_date: "2026-10-01", assignee_telegram_ids: [] }),
    task({
      id: "co",
      due_date: "2026-10-01",
      assignee_telegram_ids: [2],
      coassignee_telegram_ids: [1],
    }),
  ];
  assertEquals(countMyOverdue(tasks, ME, NOW), 2); // late + co
});

Deno.test("счётчик задач: без профиля — ноль", () => {
  assertEquals(
    countMyOverdue([task({ id: "a", due_date: "2026-10-01" })], null, NOW),
    0,
  );
});

Deno.test("кружок: ноль не рисуется, большое число усекается", () => {
  assertEquals(badgeLabel(0), null);
  assertEquals(badgeLabel(undefined), null);
  assertEquals(badgeLabel(7), "7");
  assertEquals(badgeLabel(120), "99+");
});
