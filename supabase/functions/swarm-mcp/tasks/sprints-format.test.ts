import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  formatSpaces,
  formatSprint,
  isIsoDate,
  pickSpace,
} from "./sprints-format.ts";
import type { Sprint } from "../../_shared/tasks/types.ts";
import type { SprintCycle } from "../../_shared/tasks/sprint-cycles.ts";
import type { SprintItem } from "../../_shared/tasks/sprint-items.ts";
import { computeSprintStats } from "../../_shared/tasks/sprint-stats.ts";

const row = (id: string, name: string, kind: Sprint["kind"]): Sprint => ({
  id,
  name,
  kind,
  group_id: "g",
  start_date: "2026-09-01",
  end_date: "2026-09-01",
  status: "active",
  created_at: "2026-09-01T00:00:00Z",
});

// Вкладка доски «Проекты» и пространство спринтов — одна таблица, разные сущности (#423).
const ROWS = [
  row("space-q", "Инициативы качества", "space"),
  row("space-t", "Тестовое", "space"),
  row("tab-g", "Гарро", "board_tab"),
  row("tab-t", "Тестовое", "board_tab"),
];

Deno.test("pickSpace: вкладку доски «Проекты» не берёт ни по имени, ни по id", () => {
  const byName = pickSpace(ROWS, "Гарро");
  assert(!byName.ok, "вкладка проектов не пространство");
  const byId = pickSpace(ROWS, "tab-g");
  assert(!byId.ok, "id вкладки проектов тоже не принимается");
  // Одноимённая вкладка не делает выбор неоднозначным: в пуле только пространства.
  const same = pickSpace(ROWS, "тестовое");
  assert(same.ok && same.value.id === "space-t");
});

Deno.test("pickSpace: частичное совпадение — только если оно одно", () => {
  const one = pickSpace(ROWS, "качеств");
  assert(one.ok && one.value.id === "space-q");
  const many = pickSpace([
    ...ROWS,
    row("space-q2", "Качество продукта", "space"),
  ], "качеств");
  assert(!many.ok && many.error.includes("несколько"));
});

Deno.test("isIsoDate: несуществующая дата — не дата", () => {
  assert(isIsoDate("2026-09-24"));
  assert(!isIsoDate("2026-02-31"));
  assert(!isIsoDate("24.09.2026"));
});

Deno.test("formatSpaces: вкладки проектов в списке пространств нет", () => {
  const text = formatSpaces(ROWS, []);
  assertStringIncludes(text, "Инициативы качества");
  assert(!text.includes("Гарро"));
});

const cycle: SprintCycle = {
  id: "c1",
  group_id: "g",
  tab_id: "space-t",
  check_date: "2026-09-30",
  name: "Спринт 1",
  start_date: "2026-09-24",
  end_date: "2026-10-07",
  status: "active",
  created_by: "1",
  started_at: null,
  accepted_at: null,
  accepted_by: null,
  summary: null,
  stats: null,
  created_at: "2026-09-24T00:00:00Z",
};

const item = (over: Partial<SprintItem>): SprintItem => ({
  id: "i",
  task_id: "t",
  in_plan: true,
  added_at: "",
  title: "Задача",
  status: "open",
  assignees: [],
  project_id: null,
  project: "DECIMUS",
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
  removed: false,
  removed_at: null,
  comment_count: 0,
  link_count: 0,
  hidden: false,
  ...over,
});

Deno.test("formatSprint: чужая личная задача — строкой без названия и без task_id", () => {
  const items = [
    item({ task_id: "open-1", title: "Открытая", status: "done" }),
    item({ task_id: "secret-1", title: "Секрет", hidden: true }),
  ];
  const text = formatSprint(
    cycle,
    "Тестовое",
    items,
    computeSprintStats(items),
  );
  assertStringIncludes(text, "[x] Открытая");
  assertStringIncludes(text, "личная задача");
  assert(
    !text.includes("Секрет"),
    "название чужой личной задачи не раскрывается",
  );
  assert(!text.includes("secret-1"), "и её id тоже");
  assertEquals(text.split("\n")[0], "Спринт «Спринт 1» — идёт (id: c1)");
});
