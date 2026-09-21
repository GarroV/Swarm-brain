// Раннер тот же, что у projectPicker.test.ts: deno test -A --no-check src/lib/ (зависимость —
// bare specifier из deno.json: прямые https-импорты линт запрещает).
import { assertEquals } from "@std/assert";
import {
  dropSide,
  ORDER_STEP,
  planAppend,
  planReorder,
  sortByPosition,
} from "./projectOrder.ts";

type Row = { id: string; position: number | null; created_at: string };
const row = (
  id: string,
  position: number | null,
  created_at = "2026-08-01T00:00:00Z",
): Row => ({ id, position, created_at });

// ── сортировка ───────────────────────────────────────────────────────────────

Deno.test("порядок задаёт position, при равенстве — дата создания", () => {
  const list = [
    row("c", 3000, "2026-08-03T00:00:00Z"),
    row("a", 1000, "2026-08-01T00:00:00Z"),
    row("b", 2000, "2026-08-02T00:00:00Z"),
  ];
  assertEquals(sortByPosition(list).map((r) => r.id), ["a", "b", "c"]);
});

Deno.test("одинаковые позиции разводит дата создания, а не случай", () => {
  // После перенумерации дубли не появляются, но пережить их список обязан: иначе порядок
  // «дышит» между перерисовками и человек видит, как строки сами меняются местами.
  const list = [
    row("b", 1000, "2026-08-02T00:00:00Z"),
    row("a", 1000, "2026-08-01T00:00:00Z"),
  ];
  assertEquals(sortByPosition(list).map((r) => r.id), ["a", "b"]);
});

Deno.test("строка с позицией всегда выше строки без позиции, в любом порядке на входе", () => {
  const placed = row("placed", 5000, "2026-09-09T00:00:00Z");
  const blank = row("blank", null, "2026-01-01T00:00:00Z");
  assertEquals(sortByPosition([placed, blank]).map((r) => r.id), [
    "placed",
    "blank",
  ]);
  assertEquals(sortByPosition([blank, placed]).map((r) => r.id), [
    "placed",
    "blank",
  ]);
});

Deno.test("строка без позиции уходит в хвост, там — по дате создания", () => {
  const list = [
    row("new2", null, "2026-09-02T00:00:00Z"),
    row("placed", 5000, "2026-08-01T00:00:00Z"),
    row("new1", null, "2026-09-01T00:00:00Z"),
  ];
  assertEquals(sortByPosition(list).map((r) => r.id), [
    "placed",
    "new1",
    "new2",
  ]);
});

// ── перестановка ─────────────────────────────────────────────────────────────

Deno.test("вставка между соседями — одна правка, позиция строго между ними", () => {
  const list = [row("a", 1000), row("b", 2000), row("c", 3000)];
  const plan = planReorder(list, "a", { id: "c", place: "before" });
  assertEquals(plan, [{ id: "a", position: 2500 }]);
});

Deno.test("вставка в начало — позиция меньше первой", () => {
  const list = [row("a", 1000), row("b", 2000), row("c", 3000)];
  const plan = planReorder(list, "c", { id: "a", place: "before" });
  assertEquals(plan, [{ id: "c", position: 1000 - ORDER_STEP }]);
});

Deno.test("вставка в конец — позиция больше последней", () => {
  const list = [row("a", 1000), row("b", 2000), row("c", 3000)];
  const plan = planReorder(list, "a", { id: "c", place: "after" });
  assertEquals(plan, [{ id: "a", position: 3000 + ORDER_STEP }]);
});

Deno.test("перетаскивание на самого себя ничего не меняет", () => {
  const list = [row("a", 1000), row("b", 2000)];
  assertEquals(planReorder(list, "a", { id: "a", place: "before" }), []);
});

Deno.test("перетаскивание на место, где строка и так стоит, ничего не меняет", () => {
  const list = [row("a", 1000), row("b", 2000), row("c", 3000)];
  assertEquals(planReorder(list, "a", { id: "b", place: "before" }), []);
  assertEquals(planReorder(list, "b", { id: "a", place: "after" }), []);
});

Deno.test("строки без позиции (легаси) — перенумерация всего списка в новом порядке", () => {
  const list = [
    row("a", null, "2026-08-01T00:00:00Z"),
    row("b", null, "2026-08-02T00:00:00Z"),
    row("c", null, "2026-08-03T00:00:00Z"),
  ];
  const plan = planReorder(list, "c", { id: "a", place: "before" });
  assertEquals(plan, [
    { id: "c", position: ORDER_STEP },
    { id: "a", position: ORDER_STEP * 2 },
    { id: "b", position: ORDER_STEP * 3 },
  ]);
});

Deno.test("зазора между соседями не осталось — перенумерация, а не позиция-дубль", () => {
  // Соседи с одинаковой позицией: середина совпала бы с соседом и порядок стал бы случайным.
  const list = [row("a", 1000), row("b", 2000), row("c", 2000)];
  const plan = planReorder(list, "a", { id: "c", place: "before" });
  assertEquals(plan, [
    { id: "b", position: ORDER_STEP },
    { id: "a", position: ORDER_STEP * 2 },
    { id: "c", position: ORDER_STEP * 3 },
  ]);
});

Deno.test("зазор меньше порога точности — тоже перенумерация", () => {
  const list = [row("a", 1), row("b", 2), row("c", 2 + 1e-9)];
  const plan = planReorder(list, "a", { id: "c", place: "before" });
  assertEquals(plan.length, 3);
  assertEquals(plan.map((p) => p.id), ["b", "a", "c"]);
});

// ── перенос в другого родителя (в конец) ─────────────────────────────────────

Deno.test("перенос в пустой проект — первая позиция", () => {
  assertEquals(planAppend([], "kid"), [{ id: "kid", position: ORDER_STEP }]);
});

Deno.test("перенос в непустой проект — в конец списка", () => {
  const list = [row("a", 1000), row("b", 7000)];
  assertEquals(planAppend(list, "kid"), [{ id: "kid", position: 8000 }]);
});

Deno.test("перенос в проект, где позиций ещё нет, — перенумерация, перенесённый последний", () => {
  const list = [
    row("a", null, "2026-08-01T00:00:00Z"),
    row("b", null, "2026-08-02T00:00:00Z"),
  ];
  assertEquals(planAppend(list, "kid"), [
    { id: "a", position: ORDER_STEP },
    { id: "b", position: ORDER_STEP * 2 },
    { id: "kid", position: ORDER_STEP * 3 },
  ]);
});

// ── сторона вставки под курсором ─────────────────────────────────────────────

Deno.test("курсор в первой половине строки — вставка до неё, во второй — после", () => {
  assertEquals(dropSide(100, 40, 105), "before");
  assertEquals(dropSide(100, 40, 135), "after");
});

Deno.test("ровно середина — вставка после (граница принадлежит нижней половине)", () => {
  assertEquals(dropSide(100, 40, 120), "after");
});

Deno.test("строка нулевой высоты (ещё не отрисована) не роняет расчёт", () => {
  assertEquals(dropSide(100, 0, 100), "after");
});
