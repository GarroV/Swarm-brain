import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { formatJournal, formatSpaces, formatSprint, isIsoDate, JOURNAL_LINES, pickSpace } from "./sprints-format.ts";
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
  withdrawn_at: null,
  comment_count: 0,
  link_count: 0,
  ...over,
});

Deno.test("formatSprint: строка состава с названием и task_id, шапка с этапом", () => {
  const items = [
    item({ task_id: "open-1", title: "Открытая", status: "done" }),
  ];
  const text = formatSprint(
    cycle,
    "Тестовое",
    items,
    computeSprintStats(items),
  );
  assertStringIncludes(text, "[x] Открытая");
  assertStringIncludes(text, "task_id: open-1");
  assertEquals(text.split("\n")[0], "Спринт «Спринт 1» — идёт (id: c1)");
});

Deno.test("formatSprint: снятая из идущего спринта задача — в плане невыполненной (#576)", () => {
  const items = [item({ task_id: "a", status: "done" })];
  const withdrawn = [
    item({
      task_id: "w",
      title: "Снятая",
      withdrawn_at: "2026-09-12T09:00:00Z",
    }),
  ];
  const text = formatSprint(
    cycle,
    "Тестовое",
    items,
    computeSprintStats([...items, ...withdrawn]),
  );
  assertStringIncludes(text, "План: 1 из 2 (50%)");
  assertStringIncludes(text, "снято из плана: 1");
  assert(!text.includes("Снятая"), "в составе снятой задачи нет");
});

Deno.test("журнал пространства: время по Белграду, автор, задача; пусто — так и сказано (#485)", () => {
  const text = formatJournal("Тестовое", "7", [
    {
      at: "2026-10-01T10:05:00Z",
      kind: "comment",
      actor: "Анна",
      task_id: "t1",
      task_title: "Запуск в Сербии",
      text: "комментарий: готово к ревью",
    },
  ]);
  assertStringIncludes(text, "Журнал «Тестовое» за 7 дн.");
  assertStringIncludes(
    text,
    "01.10, 12:05 · Анна · «Запуск в Сербии» — комментарий: готово к ревью",
  );
  assertEquals(
    formatJournal("Тестовое", "all", []),
    "Журнал «Тестовое» за всё время: событий нет.",
  );
});

Deno.test("журнал пространства: длинная лента режется с подсказкой сузить период", () => {
  const many = Array.from({ length: JOURNAL_LINES + 5 }, (_, i) => ({
    at: "2026-10-01T10:05:00Z",
    kind: "task_change" as const,
    actor: null,
    task_id: null,
    task_title: null,
    text: `событие ${i}`,
  }));
  const text = formatJournal("Тестовое", "all", many);
  assertStringIncludes(text, "…и ещё 5");
  assert(!text.includes(`событие ${JOURNAL_LINES}`));
});

Deno.test("formatSpaces: «сейчас» — идущий спринт, запланированные перечислены впереди по дате", () => {
  const space = ROWS.find((r) => r.kind === "space")!;
  const cycle = (id: string, status: SprintCycle["status"], start: string) =>
    ({
      id,
      tab_id: space.id,
      name: `С-${id}`,
      status,
      start_date: start,
      end_date: start,
    }) as SprintCycle;
  const text = formatSpaces(ROWS, [
    cycle("5", "draft", "2026-11-03"),
    cycle("4", "draft", "2026-10-20"),
    cycle("3", "active", "2026-10-06"),
    cycle("2", "accepted", "2026-09-22"),
  ]);
  const line = text.split("\n").find((l) => l.includes(space.id))!;
  assertEquals(line.includes("сейчас: С-3 (идёт"), true, line);
  assertEquals(line.indexOf("С-4") < line.indexOf("С-5"), true, line);
  assertEquals(line.includes("принятых: 1"), true, line);
});
