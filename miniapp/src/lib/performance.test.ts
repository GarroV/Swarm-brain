import { assertEquals } from "@std/assert";
import { performanceDirection, performanceNumber, performancePeriodLabel } from "./performance-format.ts";

Deno.test("performance growth direction reflects metric meaning", () => {
  assertEquals(performanceDirection("revenue", "-7"), "bad");
  assertEquals(performanceDirection("orders", "8"), "good");
  assertEquals(performanceDirection("delivery_seconds", "-4"), "good");
  assertEquals(performanceDirection("restaurant_cooking_seconds", "6"), "bad");
  assertEquals(performanceDirection("stops_seconds", "-19"), "good");
  assertEquals(performanceDirection("certificates_count", "0"), "neutral");
  assertEquals(performanceDirection("revenue", null), "neutral");
});

Deno.test("performance missing values remain distinct from a source zero", () => {
  assertEquals(performanceNumber(null), null);
  assertEquals(performanceNumber(""), null);
  assertEquals(performanceNumber("NaN"), null);
  assertEquals(performanceNumber("Infinity"), null);
  assertEquals(performanceNumber("0"), 0);
  assertEquals(performanceNumber("12345678.90"), 12345678.90);
});

Deno.test("performance periods show exact calendar dates without timezone shifts", () => {
  assertEquals(performancePeriodLabel({ from: "2026-11-01", to: "2026-11-14" }), "01–14.11.2026");
  assertEquals(performancePeriodLabel({ from: "2026-10-01", to: "2026-10-14" }), "01–14.10.2026");
  assertEquals(performancePeriodLabel({ from: "2026-10-30", to: "2026-11-14" }), "30.10–14.11.2026");
  assertEquals(performancePeriodLabel({ from: "2025-12-30", to: "2026-01-14" }), "30.12.2025–14.01.2026");
  assertEquals(performancePeriodLabel({ from: "2026-11-01", to: "2026-11-01" }), "01.11.2026");
  assertEquals(performancePeriodLabel({ from: "2026-02-30", to: "2026-03-01" }), "—");
  assertEquals(performancePeriodLabel({ from: "2026-11-15", to: "2026-11-14" }), "—");
});
