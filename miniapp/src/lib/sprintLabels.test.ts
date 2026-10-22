// Подписи доски: ошибка здесь молчит — «С4 → С6» не про те спринты выглядит правдоподобно.
import { assertEquals } from "@std/assert";
import { cycleDates, cycleShort, dueCycleOf, planLine } from "./sprintLabels.ts";

const c = (id: string, name: string, start: string, end: string, status = "draft") => ({
  id,
  name,
  start_date: start,
  end_date: end,
  status,
});
const cycles = [
  c("a", "Спринт 3", "2026-10-06", "2026-10-19", "accepted"),
  c("b", "Спринт 4", "2026-10-20", "2026-11-02", "active"),
  c("c", "Спринт 5", "2026-11-03", "2026-11-16"),
  c("d", "Спринт 6", "2026-11-17", "2026-11-30"),
  c("e", "Спринт 7", "2026-12-01", "2026-12-14"),
];

Deno.test("короткое имя: «Спринт N …» → «СN», иначе сокращённое имя", () => {
  assertEquals(cycleShort("Спринт 12 (осень)"), "С12");
  assertEquals(cycleShort("Sprint 4"), "С4");
  assertEquals(cycleShort("Запуск"), "Запуск");
  assertEquals(cycleShort("Большой запуск рынка"), "Больш…");
});

Deno.test("даты плитки: день.месяц без года", () => {
  assertEquals(cycleDates(cycles[2]), "03.11–16.11");
});

Deno.test("спринт срока — тот, в окно которого попал срок", () => {
  assertEquals(dueCycleOf(cycles, "2026-12-01")?.id, "e");
  assertEquals(dueCycleOf(cycles, "2027-03-01"), null);
  assertEquals(dueCycleOf(cycles, null), null);
});

Deno.test("отрезок: первый и последний незакрытый спринт задачи по дате начала", () => {
  const line = planLine({ due_date: "2026-12-01", cycle_ids: ["d", "b", "c"] }, cycles);
  assertEquals(line, { kind: "span", from: "С4", to: "С6", due: { date: "2026-12-01", longer: false } });
});

Deno.test("один спринт — без стрелки; принятый в отрезок не входит", () => {
  assertEquals(planLine({ due_date: null, cycle_ids: ["a", "c"] }, cycles), {
    kind: "span",
    from: "С5",
    to: null,
    due: null,
  });
});

Deno.test("план дольше срока: последний спринт кончается позже срока", () => {
  const line = planLine({ due_date: "2026-11-20", cycle_ids: ["c", "e"] }, cycles);
  assertEquals(line.kind === "span" && line.due?.longer, true);
});

Deno.test("только принятые спринты или ни одного — «не в спринтах»", () => {
  assertEquals(planLine({ due_date: "2026-12-01", cycle_ids: ["a"] }, cycles), { kind: "none" });
  assertEquals(planLine({ due_date: null, cycle_ids: [] }, cycles), { kind: "none" });
});
