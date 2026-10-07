// Раскладка главной из виджетов: перестановка, ширина, скрытие, разбор сохранённого.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { addWidget, DEFAULT_LAYOUT, hideWidget, moveBefore, moveBy, parseLayout, toggleWidth } from "./homeLayout.ts";

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
  assertEquals(moveBy(DEFAULT_LAYOUT, "calls", -1), DEFAULT_LAYOUT);
  assertEquals(moveBy(DEFAULT_LAYOUT, "calls", 1).slice(0, 2).map((x) => x.id), ["top5", "calls"]);
});

Deno.test("toggleWidth, hide and add keep the rest untouched", () => {
  const wide = toggleWidth(DEFAULT_LAYOUT, "calls");
  assertEquals(wide[0], { id: "calls", w: "full" });
  assertEquals(wide.slice(1), DEFAULT_LAYOUT.slice(1));
  const hidden = hideWidget(DEFAULT_LAYOUT, "board");
  assertEquals(hidden.some((x) => x.id === "board"), false);
  assertEquals(addWidget(hidden, "board").at(-1), { id: "board", w: "full" });
  assertEquals(addWidget(DEFAULT_LAYOUT, "calls"), DEFAULT_LAYOUT);
});
