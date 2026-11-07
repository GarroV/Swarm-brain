import { assertEquals } from "@std/assert";
import { RO } from "./countries/RO.ts";
import { parseRoBilant } from "./registry.ts";

// Actual 2025 Ministry of Finance rows; URLs and CUI provenance are in ARCHITECTURE.md.
const rows = Deno.readTextFileSync(
  new URL("./fixtures/ro-operators-2025.txt", import.meta.url),
).split("\n");
const years = parseRoBilant(
  rows,
  new Set(RO.companies.map((co) => co.regId)),
  2025,
  5.0423901960784,
);

for (
  const [chain, cui, turnover, employees] of [
    ["kfc", "6645790", 1133473526, 3071],
    ["pizzahut", "6331682", 106788244, 385],
  ] as const
) {
  Deno.test(`RO ${chain}: the configured operator imports its restaurant revenue`, () => {
    const operators = RO.companies.filter((co) => co.chain === chain);
    assertEquals(operators.map((co) => co.regId), [cui]);
    const financial = years.find((y) => y.reg_id === cui);
    assertEquals(
      financial?.revenue_eur,
      Math.round(turnover / 5.0423901960784 * 100) / 100,
    );
    assertEquals(financial?.employees, employees);
  });
}

Deno.test("RO Sphera: standalone holding financials are retained without a restaurant brand", () => {
  assertEquals(RO.companies.find((co) => co.regId === "37586457")?.chain, null);
  assertEquals(years.filter((y) => y.reg_id === "37586457").length, 1);
});
