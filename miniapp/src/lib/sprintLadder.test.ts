// Лесенка колонки доски: ошибка здесь молчит — подзадача оказывается не под тем родителем или
// теряется из колонки, и человек не видит часть спринта.
import { assertEquals } from "@std/assert";
import { buildLadder, kidsElsewhere } from "./sprintLadder.ts";

const row = (id: string, task_id: string | null) => ({ id, task_id });
const parents: Record<string, string | null> = { b: "a", c: "r", e: "a" };
const parentOf = (t: string) => parents[t] ?? null;

Deno.test("подзадача — под родителем той же колонки, в порядке колонки", () => {
  const items = [row("1", "a"), row("2", "d"), row("3", "b"), row("4", "e")];
  const ladder = buildLadder(items, parentOf);
  assertEquals(ladder.map((n) => n.item.task_id), ["a", "d"]);
  assertEquals(ladder[0].kids.map((k) => k.task_id), ["b", "e"]);
  assertEquals(ladder[1].kids, []);
});

Deno.test("родитель не в колонке — подзадача отдельной карточкой, не пропадает", () => {
  const ladder = buildLadder([row("1", "c"), row("2", "d")], parentOf);
  assertEquals(ladder.map((n) => n.item.task_id), ["c", "d"]);
});

Deno.test("строка без задачи (удалена) остаётся корнем", () => {
  const ladder = buildLadder([row("1", null)], parentOf);
  assertEquals(ladder.length, 1);
});

const cycles = [
  { id: "c4", name: "Спринт 4", start_date: "2026-10-20", status: "active" },
  { id: "c5", name: "Спринт 5", start_date: "2026-11-03", status: "draft" },
  { id: "c6", name: "Спринт 6", start_date: "2026-11-17", status: "draft" },
  { id: "c3", name: "Спринт 3", start_date: "2026-10-06", status: "accepted" },
];

Deno.test("«ещё N в СX»: незакрытые подзадачи из других спринтов, по ближайшему", () => {
  const kids = [
    { id: "k1", status: "open", cycle_ids: ["c6", "c5"] },
    { id: "k2", status: "open", cycle_ids: ["c6"] },
    { id: "k3", status: "done", cycle_ids: ["c5"] },
    { id: "k4", status: "open", cycle_ids: ["c4"] },
    { id: "k5", status: "open", cycle_ids: ["c3"] },
    { id: "k6", status: "open", cycle_ids: [] },
  ];
  assertEquals(kidsElsewhere(kids, "c4", new Set(["k4"]), cycles), [
    { short: "С5", n: 1 },
    { short: "С6", n: 1 },
  ]);
});
