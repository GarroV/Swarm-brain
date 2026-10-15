// Раскладка главной из виджетов: перестановка, ширина, скрытие, разбор сохранённого.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { addWidget, DEFAULT_LAYOUT, halfColumns, WIDGET_IDS, hideWidget, moveBefore, moveBy, parseLayout, toggleWidth } from "./homeLayout.ts";

Deno.test("parseLayout drops unknown widgets, duplicates and bad widths", () => {
  const got = parseLayout([{ id: "rs", w: "full" }, { id: "nope", w: "half" }, { id: "rs", w: "half" }, { id: "calls", w: "huge" }]);
  assertEquals(got, [{ id: "rs", w: "full" }, { id: "calls", w: "half" }]);
});

Deno.test("parseLayout rejects non-arrays", () => {
  assertEquals(parseLayout({ id: "rs" }), null);
  assertEquals(parseLayout(null), null);
});

Deno.test("moveBefore puts the dragged widget in front of the target", () => {
  const l = [{ id: "calls", w: "half" }, { id: "top5", w: "half" }, { id: "rs", w: "half" }] as const;
  assertEquals(moveBefore([...l], "rs", "calls").map((x) => x.id), ["rs", "calls", "top5"]);
  assertEquals(moveBefore([...l], "calls", "rs").map((x) => x.id), ["top5", "calls", "rs"]);
});

Deno.test("moveBy stops at the edges", () => {
  const [first, second] = DEFAULT_LAYOUT.map((x) => x.id);
  assertEquals(moveBy(DEFAULT_LAYOUT, first, -1), DEFAULT_LAYOUT);
  assertEquals(moveBy(DEFAULT_LAYOUT, first, 1).slice(0, 2).map((x) => x.id), [second, first]);
});

Deno.test("toggleWidth, hide and add keep the rest untouched", () => {
  const wide = toggleWidth(DEFAULT_LAYOUT, "calls");
  assertEquals(wide.find((x) => x.id === "calls"), { id: "calls", w: "full" });
  assertEquals(wide.filter((x) => x.id !== "calls"), DEFAULT_LAYOUT.filter((x) => x.id !== "calls"));
  const hidden = hideWidget(DEFAULT_LAYOUT, "board");
  assertEquals(hidden.some((x) => x.id === "board"), false);
  assertEquals(addWidget(hidden, "board").at(-1), { id: "board", w: "full" });
  assertEquals(addWidget(DEFAULT_LAYOUT, "calls"), DEFAULT_LAYOUT);
});

Deno.test("sample violations widget is in the catalog but not on the default home", () => {
  assertEquals(WIDGET_IDS.includes("viol"), true);
  assertEquals(DEFAULT_LAYOUT.some((x) => x.id === "viol"), false);
  assertEquals(addWidget(DEFAULT_LAYOUT, "viol").at(-1), { id: "viol", w: "half" });
});

Deno.test("default home: РКО над РС слева, встречи над задачами справа", () => {
  const runs = halfColumns(DEFAULT_LAYOUT);
  assertEquals(runs[0].kind === "full" && runs[0].item.id, "board");
  const halves = runs[1];
  if (halves.kind !== "halves") throw new Error("второй прогон — половинки");
  assertEquals(halves.left.map((x) => x.item.id), ["rko", "rs"]);
  assertEquals(halves.right.map((x) => x.item.id), ["calls", "top5"]);
});

Deno.test("halfColumns: full row splits half runs, odd tail goes left, index is the layout position", () => {
  const runs = halfColumns([
    { id: "rs", w: "half" }, { id: "board", w: "full" }, { id: "rko", w: "half" }, { id: "calls", w: "half" }, { id: "top5", w: "half" },
  ]);
  assertEquals(runs.map((r) => r.kind), ["halves", "full", "halves"]);
  const last = runs[2];
  if (last.kind !== "halves") throw new Error("третий прогон — половинки");
  assertEquals(last.left.map((x) => [x.item.id, x.index]), [["rko", 2], ["top5", 4]]);
  assertEquals(last.right.map((x) => [x.item.id, x.index]), [["calls", 3]]);
});
