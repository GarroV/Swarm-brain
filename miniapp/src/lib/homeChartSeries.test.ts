import { assertEquals } from "jsr:@std/assert@1";
import { bucketize, canShift, clampRange, monthKey, niceScale, rangeLabel, shiftRange, type Point } from "./homeChartSeries.ts";

const m = (y: number, mo: number) => y * 12 + (mo - 1);
const BOUNDS = { from: m(2024, 10), to: m(2026, 9) };

Deno.test("shiftRange pages by the period length and stops at the data edges", () => {
  const r = { from: m(2026, 2), to: m(2026, 9) }; // 8 месяцев
  assertEquals(shiftRange(r, -1, BOUNDS), { from: m(2025, 6), to: m(2026, 1) });
  assertEquals(shiftRange(r, 1, BOUNDS), r); // правее данных нет
  assertEquals(canShift(r, 1, BOUNDS), false);
  assertEquals(canShift(r, -1, BOUNDS), true);
  assertEquals(shiftRange({ from: m(2024, 12), to: m(2025, 3) }, -1, BOUNDS), { from: m(2024, 10), to: m(2025, 1) });
});

Deno.test("clampRange fixes reversed input and keeps the length", () => {
  assertEquals(clampRange({ from: m(2026, 9), to: m(2026, 7) }, BOUNDS), { from: m(2026, 7), to: m(2026, 9) });
  assertEquals(clampRange({ from: m(2026, 8), to: m(2026, 11) }, BOUNDS), { from: m(2026, 6), to: m(2026, 9) });
});

Deno.test("rangeLabel reads like a person would say it", () => {
  assertEquals(rangeLabel({ from: m(2026, 2), to: m(2026, 9) }, false), "Фев — Сен 2026");
  assertEquals(rangeLabel({ from: m(2025, 11), to: m(2026, 2) }, false), "Ноя 2025 — Фев 2026");
  assertEquals(rangeLabel({ from: m(2026, 9), to: m(2026, 9) }, true), "Sep 2026");
});

const waves: Point[] = [
  { date: new Date(2026, 6, 1), value: 80 }, { date: new Date(2026, 6, 16), value: 84 },
  { date: new Date(2026, 7, 1), value: 90 }, { date: new Date(2026, 7, 16), value: 92 },
  { date: new Date(2026, 8, 1), value: 70 }, { date: new Date(2026, 8, 16), value: 75 },
];

Deno.test("bucketize keeps waves, averages months and quarters, filters by period", () => {
  const all = { from: m(2026, 7), to: m(2026, 9) };
  assertEquals(bucketize(waves, all, "wave", false).map((b) => b.label), ["Июл 1", "Июл 2", "Авг 1", "Авг 2", "Сен 1", "Сен 2"]);
  assertEquals(bucketize(waves, all, "month", false).map((b) => [b.label, b.value]), [["Июл 26", 82], ["Авг 26", 91], ["Сен 26", 72.5]]);
  assertEquals(bucketize(waves, all, "quarter", true).map((b) => [b.label, b.value]), [["Q3 26", 81.8]]);
  assertEquals(bucketize(waves, { from: m(2026, 8), to: m(2026, 8) }, "wave", false).map((b) => b.value), [90, 92]);
  assertEquals(bucketize(waves, { from: m(2025, 1), to: m(2025, 2) }, "month", false), []);
});

Deno.test("week buckets are keyed by the local date", () => {
  const w = bucketize([{ date: new Date(2026, 8, 28), value: 1 }], { from: monthKey(new Date(2026, 8, 1)), to: monthKey(new Date(2026, 8, 1)) }, "week", false);
  assertEquals(w.map((b) => [b.key, b.label]), [["2026-09-28", "28.09"]]);
});

Deno.test("niceScale includes the norm and steps by round numbers", () => {
  const s = niceScale([81, 83, 79], 90);
  assertEquals(s.ticks.includes(90) || s.max >= 90, true);
  assertEquals(s.min <= 79, true);
  assertEquals(s.ticks.every((t) => Number.isInteger(t * 2)), true);
  assertEquals(niceScale([99, 100], 90).max, 100); // выше сотни шкала не уходит
});
