import { assertEquals } from "@std/assert";
import { groupSales, MAX_SALES_COUNTRIES, parseSalesCountries } from "./sales.ts";

Deno.test("parseSalesCountries: uppercases, trims and dedupes", () => {
  assertEquals(parseSalesCountries("bg, HR,bg"), ["BG", "HR"]);
});

Deno.test("parseSalesCountries: empty, malformed or oversized input is rejected", () => {
  assertEquals(parseSalesCountries(null), null);
  assertEquals(parseSalesCountries(""), null);
  assertEquals(parseSalesCountries("BGR"), null);
  assertEquals(parseSalesCountries("B1"), null);
  assertEquals(parseSalesCountries("BG,;drop"), null);
  const many = Array.from(
    { length: MAX_SALES_COUNTRIES + 1 },
    (_, i) => String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)),
  ).join(",");
  assertEquals(parseSalesCountries(many), null);
});

Deno.test("groupSales: groups per country, sorts months, keeps empty countries, drops foreign rows", () => {
  const r = groupSales(["BG", "HR"], [
    { country: "BG", month: "2026-02-01", revenue_eur: 2, complete: true },
    { country: "BG", month: "2026-01-01", revenue_eur: 1, complete: true },
    { country: "XX", month: "2026-01-01", revenue_eur: 9, complete: true },
  ]);
  assertEquals(r.BG.map((m) => m.month), ["2026-01-01", "2026-02-01"]);
  assertEquals(r.HR, []);
  assertEquals("XX" in r, false);
});
