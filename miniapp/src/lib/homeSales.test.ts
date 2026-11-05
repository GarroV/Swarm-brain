import { assertEquals } from "@std/assert";
import { loadedLabel, NO_UNIT_SALES, toUnitSales, unitRevenue } from "./homeSales.ts";

const US = toUnitSales({
  month: "2026-11",
  loaded: { SI: "2026-11-05T09:53:41Z", RS: "2026-11-05T09:53:32Z" },
  units: { "11f004bc8b23bd3a10d3edd76d0a7510": 2826.81, "76c13c596caa978911ee64736ea86365": 4134.62 },
});

Deno.test("unitRevenue: found by id in any letter case; unknown pizzeria and missing state are null, never a guess", () => {
  assertEquals(unitRevenue(US, "11F004BC8B23BD3A10D3EDD76D0A7510"), 2826.81);
  assertEquals(unitRevenue(US, "aa".repeat(16)), null);
  assertEquals(unitRevenue(undefined, "11f004bc8b23bd3a10d3edd76d0a7510"), null);
  assertEquals(unitRevenue(NO_UNIT_SALES, "11f004bc8b23bd3a10d3edd76d0a7510"), null);
});

Deno.test("toUnitSales: server without the field (old functions) or null gives the empty state", () => {
  assertEquals(toUnitSales(undefined), NO_UNIT_SALES);
  assertEquals(toUnitSales(null), NO_UNIT_SALES);
});

Deno.test("loadedLabel: countries sorted, time in the given zone; no loads or a bad date give nothing", () => {
  assertEquals(loadedLabel(US.loaded, "en-GB", "Europe/Belgrade"), "RS 05/11, 10:53; SI 05/11, 10:53");
  assertEquals(loadedLabel({}, "en-GB"), "");
  assertEquals(loadedLabel(undefined, "en-GB"), "");
  assertEquals(loadedLabel({ RS: "not a date" }, "en-GB"), "");
});
