// Границы загрузки в общую таблицу баллов: что удаляется, чьи страны, чьи пиццерии. Синтетика.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { foreignCountries, staleKeys, unitMoves } from "./scope.ts";

const k = (unit_id: string, period_start: string) => ({ unit_id, period_start });
const e = (unit_id: string, period_start: string, country_code = "RS") => ({ unit_id, period_start, country_code });
const score = (unit_id: string, period_start: string) => ({
  unit_id,
  unit_name: unit_id,
  country_code: "RS",
  developer: null,
  period_start,
  period_end: period_start,
  score: 90,
});
const unit = (id: string, cc = "RS") => ({ id, name: `Name-${id}`, cc });

Deno.test("only scores that vanished inside the imported periods, units and their country are stale", () => {
  const parsed = {
    periods: [{ start: "2026-02-01", end: "", label: "" }, { start: "2026-02-16", end: "", label: "" }],
    sheetUnits: [unit("a"), unit("b"), unit("c")],
    scores: [score("a", "2026-02-01")],
    badCells: [k("b", "2026-02-16")],
  };
  const existing = [
    e("a", "2026-02-01"), // всё ещё в листе
    e("a", "2026-02-16"), // исчез из листа — удалить
    e("a", "2026-01-16"), // период вне выгрузки — не трогать
    e("b", "2026-02-16"), // в листе опечатка — не трогать
    e("c", "2026-02-01"), // пиццерия в листе, балл стёрт — удалить
    e("z", "2026-02-01"), // пиццерии нет в листе — не трогать
    e("c", "2026-02-16", "BG"), // та же пиццерия, но строка чужой страны — не трогать
  ];
  assertEquals(staleKeys(existing, parsed), [k("a", "2026-02-16"), k("c", "2026-02-01")]);
});

Deno.test("foreignCountries lists sheet countries outside the workspace markets, case-insensitive", () => {
  assertEquals(foreignCountries(["BG", "RS", "TR"], ["rs", " bg"]), ["TR"]);
  assertEquals(foreignCountries(["BG"], null), []);
  assertEquals(foreignCountries(["BG"], []), ["BG"]);
});

Deno.test("unitMoves finds sheet units stored under another country, once per unit and country", () => {
  const sheet = [unit("a", "RS"), unit("b", "RS"), unit("c", "BG")];
  const stored = [
    { unit_id: "a", country_code: "RS" }, // та же страна — не перенос
    { unit_id: "b", country_code: "TR" }, // чужая воркспейсу страна
    { unit_id: "b", country_code: "TR" },
    { unit_id: "c", country_code: "rs" }, // своя страна, но другая
    { unit_id: "z", country_code: "TR" }, // не из листа
  ];
  assertEquals(unitMoves(sheet, stored, ["RS", "BG"]), [
    { id: "b", name: "Name-b", from: "TR", to: "RS", foreign: true },
    { id: "c", name: "Name-c", from: "RS", to: "BG", foreign: false },
  ]);
  assertEquals(unitMoves(sheet, stored, null).map((m) => m.foreign), [false, false]);
});
