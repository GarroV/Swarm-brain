import { assertEquals } from "jsr:@std/assert";
import { CAL_MAX_DAYS, calendarDays, calendarLayout, whatsNext } from "./taskCalendar.ts";
import type { Task } from "../types.ts";

const NOW = new Date(2026, 8, 24, 12, 0, 0); // чт 24.09.2026

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
const ids = (ts: Task[]) => ts.map((t) => t.id);

Deno.test("calendarDays: без периода — текущая неделя с понедельника", () => {
  const c = calendarDays(null, NOW);
  assertEquals(c.days, ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
  assertEquals([c.defaulted, c.cut], [true, false]);
});

Deno.test("calendarDays: длинный период режется и говорит об этом", () => {
  const c = calendarDays({ preset: "custom", from: "2026-01-01", to: "2026-12-31" }, NOW);
  assertEquals(c.days.length, CAL_MAX_DAYS);
  assertEquals(c.days[0], "2026-01-01");
  assertEquals(c.cut, true);
});

Deno.test("calendarLayout: задачи по дням, без срока отдельно, вне сетки — числом", () => {
  const days = calendarDays(null, NOW).days;
  const l = calendarLayout([
    task({ id: "a", due_date: "2026-09-22", assignee_telegram_ids: [2] }),
    task({ id: "b", due_date: "2026-09-22", assignee_telegram_ids: [1] }),
    task({ id: "n" }),
    task({ id: "far", due_date: "2026-10-15" }),
    task({ id: "past", due_date: "2026-09-01" }),
  ], days);
  assertEquals(ids(l.byDay.get("2026-09-22")!), ["b", "a"]); // по человеку
  assertEquals(ids(l.nodue), ["n"]);
  assertEquals(l.outside, 2);
  assertEquals(l.byDay.get("2026-09-23"), []);
});

Deno.test("whatsNext: только под коротким списком, без повторов, ближайшие сроки первыми", () => {
  const shown = [task({ id: "s", due_date: "2026-09-25" })];
  const pool = [
    ...shown,
    task({ id: "late", due_date: "2026-10-20" }),
    task({ id: "soon", due_date: "2026-09-28" }),
    task({ id: "nodue" }),
    task({ id: "d1", status: "done", completed_at: "2026-09-20T10:00:00Z" }),
    task({ id: "d2", status: "done", completed_at: "2026-09-23T10:00:00Z" }),
  ];
  const n = whatsNext(pool, shown);
  assertEquals(ids(n.soon), ["soon", "late"]);
  assertEquals(ids(n.done), ["d2", "d1"]);
  const long = Array.from({ length: 7 }, (_, i) => task({ id: `x${i}` }));
  assertEquals(whatsNext(pool, long), { soon: [], done: [] });
});
