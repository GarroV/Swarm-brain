import { assertEquals } from "jsr:@std/assert@1";
import { fmtK, opsByMonth, opsByUnit, opsSum, scaleBottom, scaleTop, ticks, unitGrowthIndex } from "./marketDodo.ts";
import type { EdDodoOps } from "./marketEditorial.ts";

const r = (u: string, m: number, rev: number, o: number, agg = 0, oagg = 0): EdDodoOps => ({ u, m, rev, agg, din: rev - agg, own: 0, o, oagg, odin: o - oagg, oown: 0 });
const rows = [r("North", 2, 100, 10, 40, 3), r("South", 1, 50, 5), r("North", 1, 80, 8, 20, 2), r("South", 2, 60, 6)];

Deno.test("ops sums by month in month order and by pizzeria with the country total last", () => {
  assertEquals(opsSum(rows).rev, 290);
  assertEquals(opsByMonth(rows).map((x) => [x.m, x.rev, x.o, x.oagg]), [[1, 130, 13, 2], [2, 160, 16, 3]]);
  assertEquals(opsByUnit(rows).map((x) => [x.u, x.rev, x.o]), [["North", 180, 18], ["South", 110, 11], [null, 290, 29]]);
});

Deno.test("scales keep the reference range and widen only when data exceed it", () => {
  assertEquals(scaleTop(102_070, 40_000, 120_000), 120_000);
  assertEquals(scaleTop(130_000, 40_000, 120_000), 160_000);
  assertEquals(scaleBottom(12.7, 4, 10), 10);
  assertEquals(scaleBottom(7.5, 4, 10), 4);
  assertEquals(ticks(10, 26, 4), [10, 14, 18, 22, 26]);
});

Deno.test("second pizzeria starts at the first month the unit count grows", () => {
  assertEquals(unitGrowthIndex([1, 1, 2, 2, 1, 2]), 2);
  assertEquals(unitGrowthIndex([1, null, 2]), null);
  assertEquals(unitGrowthIndex([2, 2]), null);
});

Deno.test("money like the reference table: millions with two decimals, else thousands", () => {
  assertEquals([fmtK(4_092_834, true), fmtK(813_000, true), fmtK(null, true), fmtK(1_179_152, false), fmtK(999_499, false)], ["€4,09 млн", "€813 тыс.", "—", "€1.18m", "€999k"]);
});
