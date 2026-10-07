import { assertEquals } from "jsr:@std/assert";
import { bucketLabel, bucketUsage, shiftRange } from "./usageBuckets.ts";

const days = [
  { day: "2026-10-01", usd: 1, calls: 1 },
  { day: "2026-10-06", usd: 2, calls: 2 },
  { day: "2026-10-12", usd: 0.5, calls: 1 },
  { day: "2026-11-02", usd: 4, calls: 3 },
  { day: "2026-09-30", usd: 99, calls: 9 }, // вне периода
];

Deno.test("день: пустые дни — нулевые столбцы, ось не схлопывается (#822)", () => {
  const b = bucketUsage(days, "2026-10-01", "2026-10-07", "day");
  assertEquals(b.length, 7);
  assertEquals(b.map((x) => x.usd), [1, 0, 0, 0, 0, 2, 0]);
});

Deno.test("неделя с понедельника, крайние недели обрезаны по периоду", () => {
  const b = bucketUsage(days, "2026-10-01", "2026-10-31", "week");
  assertEquals(b.map((x) => [x.start, x.end]), [
    ["2026-10-01", "2026-10-04"],
    ["2026-10-05", "2026-10-11"],
    ["2026-10-12", "2026-10-18"],
    ["2026-10-19", "2026-10-25"],
    ["2026-10-26", "2026-10-31"],
  ]);
  assertEquals(b.map((x) => x.usd), [1, 2, 0.5, 0, 0]);
  assertEquals(b.reduce((s, x) => s + x.calls, 0), 4);
});

Deno.test("месяц: сумма сходится с итогом периода", () => {
  const b = bucketUsage(days, "2026-10-01", "2026-11-30", "month");
  assertEquals(b.map((x) => [x.start, x.usd, x.calls]), [["2026-10-01", 3.5, 4], ["2026-11-01", 4, 3]]);
  assertEquals(bucketLabel(b[0], "month", "ru"), "окт 2026");
});

Deno.test("стрелки: целый месяц листается месяцем, иначе — на длину периода", () => {
  assertEquals(shiftRange({ preset: "month", from: "2026-10-01", to: "2026-10-31" }, -1),
    { preset: "custom", from: "2026-09-01", to: "2026-09-30" });
  assertEquals(shiftRange({ preset: "custom", from: "2026-01-31", to: "2026-01-31" }, 1).from, "2026-02-01");
  assertEquals(shiftRange({ preset: "custom", from: "2026-10-01", to: "2026-10-10" }, 1),
    { preset: "custom", from: "2026-10-11", to: "2026-10-20" });
});
