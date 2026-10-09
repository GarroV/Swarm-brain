// Ответ Децимуса → GET /quality: кривые данные чужой системы — ошибка, а не тихий ноль;
// страны режутся и у нас, даже если Децимус отдал лишнее.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { toView } from "./quality-view.ts";

const body = {
  type: "rs",
  periods: [{ id: 1, start: "2026-09-01", end: "2026-09-15" }, { id: 2, start: "2026-09-16", end: "2026-09-30" }],
  units: [
    { id: "a".repeat(32), name: "Alpha-1", cc: "rs", developer: "Dev", scores: [90, null] },
    { id: "b".repeat(32), name: "Beta-1", cc: "HR", developer: null, scores: [null, 72.5] },
  ],
};

Deno.test("toView: периоды и баллы как есть, код страны в верхнем регистре", () => {
  const v = toView("rs", body, null);
  assertEquals(v.periods, [{ start: "2026-09-01", end: "2026-09-15" }, { start: "2026-09-16", end: "2026-09-30" }]);
  assertEquals(v.units.map((u) => [u.cc, u.scores]), [["RS", [90, null]], ["HR", [null, 72.5]]]);
});

Deno.test("toView: страны вне рынков воркспейса отбрасываются", () => {
  assertEquals(toView("rs", body, ["RS"]).units.map((u) => u.name), ["Alpha-1"]);
});

Deno.test("toView: баллы не по числу периодов — ошибка", () => {
  const bad = { ...body, units: [{ ...body.units[0], scores: [90] }] };
  assertThrows(() => toView("rs", bad, null), Error, "не выровнены");
});

Deno.test("toView: балл вне 0–100 или строкой — ошибка", () => {
  assertThrows(() => toView("rs", { ...body, units: [{ ...body.units[0], scores: [101, null] }] }, null));
  assertThrows(() => toView("rs", { ...body, units: [{ ...body.units[0], scores: ["90", null] }] }, null));
});

Deno.test("toView: нет periods или кривая дата — ошибка", () => {
  assertThrows(() => toView("rs", { units: [] }, null));
  assertThrows(() => toView("rs", { periods: [{ start: "16.09", end: "30.09" }], units: [] }, null));
});
