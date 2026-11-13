// Модель «Ленты времени»: окно спринтов, геометрия, состояния отрезков, переносы с причиной.
// Раннер: deno test -A --no-check src/lib/ (bare specifier из deno.json).
import { assertEquals } from "@std/assert";
import {
  buildColumns,
  buildGroups,
  colPos,
  dayFraction,
  summarize,
} from "./sprintTimeline.ts";
import type {
  BoardPlanTask,
  SprintBoardData,
  SprintCycle,
  SprintCycleItem,
} from "../types.ts";

const cyc = (
  id: string,
  start: string,
  end: string,
  status: SprintCycle["status"],
  extra: Partial<SprintCycle> = {},
): SprintCycle => ({
  id,
  group_id: "g",
  name: id,
  start_date: start,
  end_date: end,
  tab_id: "t",
  check_date: null,
  status,
  created_by: null,
  started_at: null,
  accepted_at: null,
  accepted_by: null,
  summary: null,
  stats: null,
  created_at: start,
  ...extra,
});

const item = (
  task_id: string,
  extra: Partial<SprintCycleItem> = {},
): SprintCycleItem => ({
  id: `i-${task_id}`,
  task_id,
  in_plan: true,
  added_at: "",
  title: task_id,
  status: "open",
  assignees: [],
  project_id: null,
  project: null,
  completed_at: null,
  due_date: null,
  frozen: false,
  check_status: null,
  check_note: null,
  check_at: null,
  check_by: null,
  to_carry: false,
  carry_reason: null,
  carry_count: 0,
  carried_manual: null,
  comment_count: 0,
  link_count: 0,
  removed: false,
  removed_at: null,
  ...extra,
});

const task = (
  id: string,
  cycle_ids: string[],
  status = "open",
): BoardPlanTask => ({
  id,
  title: id,
  status,
  due_date: null,
  assignees: [],
  assignee_telegram_ids: [],
  parent_id: null,
  created_at: "",
  cycle_ids,
  moves: 0,
});

const snap = (
  task_id: string,
  to: string | null,
  reason: string | null,
): SprintCycleItem =>
  item(task_id, {
    moved: {
      to_cycle_id: to,
      to_cycle_name: to,
      at: "2026-11-10T00:00:00Z",
      by: null,
      reason,
      due_now: null,
    },
  });

function board(): SprintBoardData {
  return {
    plan: {
      groups: [{
        id: "g1",
        name: "G1",
        tasks: [
          task("a", ["c1", "c2"]),
          task("b", ["c2"]),
          task("far", []),
          task("m", ["c2"]),
        ],
      }],
    },
    cycles: [
      {
        cycle: cyc("c0", "2026-10-13", "2026-10-26", "accepted"),
        items: [],
        moved: [],
        withdrawn: [],
        loaded: false,
      },
      {
        cycle: cyc("c1", "2026-10-27", "2026-11-09", "accepted"),
        items: [],
        moved: [],
        withdrawn: [],
        loaded: false,
      },
      {
        cycle: cyc("c2", "2026-11-10", "2026-11-23", "active", {
          check_date: "2026-11-16",
        }),
        items: [item("a"), item("b", { check_status: "risk" }), item("m")],
        moved: [],
        withdrawn: [],
        loaded: true,
      },
      {
        cycle: cyc("c3", "2026-11-24", "2026-12-07", "draft"),
        items: [],
        moved: [],
        withdrawn: [],
        loaded: true,
      },
    ],
  };
}

Deno.test("timeline: окно — два принятых, идущий, будущие; ширины в сумме 100%", () => {
  const cols = buildColumns(board(), new Map());
  assertEquals(cols.map((c) => c.cycle.id), ["c0", "c1", "c2", "c3"]);
  assertEquals(Math.round(cols.reduce((s, c) => s + c.width, 0)), 100);
  assertEquals(cols[0].left, 0);
  assertEquals(cols[2].width > cols[0].width, true);
});

Deno.test("timeline: сегодня внутри идущего спринта, вне него — null", () => {
  const cols = buildColumns(board(), new Map());
  const f = dayFraction(cols[2].cycle, "2026-11-12");
  assertEquals(f !== null && colPos(cols[2], f) > cols[2].left, true);
  assertEquals(dayFraction(cols[2].cycle, "2026-11-09"), null);
});

Deno.test("timeline: состояние отрезка — риск с сверки, готово по статусу; задача вне окна не строится", () => {
  const cols = buildColumns(board(), new Map());
  const rows = buildGroups(board(), cols)[0].rows;
  assertEquals(rows.find((r) => r.task.id === "b")?.state, "risk");
  assertEquals(rows.find((r) => r.task.id === "a")?.cols, [1, 2]);
  assertEquals(rows.some((r) => r.task.id === "far"), false);
  assertEquals(buildGroups(board(), cols)[0].hidden, 1);
});

Deno.test("timeline: перенос без причины просит внимания, цель находится по спринту", () => {
  const b = board();
  b.cycles[2].moved = [snap("m", "c3", null)];
  b.cycles[2].cycle = { ...b.cycles[2].cycle };
  const cols = buildColumns(
    b,
    new Map([["c1", [snap("a", "c2", "ждали API")]]]),
  );
  const rows = buildGroups(b, cols)[0].rows;
  const m = rows.find((r) => r.task.id === "m")!;
  assertEquals(m.moves[0].from, 2);
  assertEquals(m.moves[0].to, 3);
  assertEquals(m.attention, true);
  const a = rows.find((r) => r.task.id === "a")!;
  assertEquals(a.moves[0].snapshot.moved?.reason, "ждали API");
  assertEquals(a.attention, false);
});

Deno.test("timeline: сводка — готово из состава, дни до конца и до сверки", () => {
  const b = board();
  b.cycles[2].items[0] = item("a", { status: "done" });
  const s = summarize(buildColumns(b, new Map()), "2026-11-12");
  assertEquals([s.done, s.total, s.daysToEnd, s.daysToCheck], [1, 3, 12, 4]);
});
