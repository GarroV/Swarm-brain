// Раннер — ./scripts/check из корня репозитория (deno.json даёт алиас `@/`): deno test -A --no-check miniapp/src/lib/
// Подписи дат на языке интерфейса (issue #625): в английском демо даты шли по-русски.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fmtFull, fmtShort, monthName, weekdays } from "./calendar.ts";
import { rangeLabel } from "./dateRange.ts";

Deno.test("английский интерфейс получает английские даты", () => {
  assertEquals(fmtShort("2026-09-30", "en"), "30 Sep");
  assertEquals(fmtFull("2026-09-30", "en"), "30 September 2026");
  assertEquals(monthName(8, "en"), "September");
  assertEquals(weekdays("en")[0], "Mo");
});

Deno.test("без языка — русский, как раньше: старые вызовы не меняются", () => {
  assertEquals(fmtShort("2026-09-30"), "30 сен");
  assertEquals(fmtFull("2026-09-30"), "30 сентября 2026");
  assertEquals(monthName(8), "Сентябрь");
  assertEquals(weekdays()[0], "Пн");
});

Deno.test("подпись периода — на языке интерфейса", () => {
  assertEquals(rangeLabel(null, "en"), "Any time");
  assertEquals(rangeLabel({ preset: "week", from: "2026-09-28", to: "2026-10-04" }, "en"), "This week");
  assertEquals(rangeLabel({ preset: "custom", from: "2026-09-12", to: "2026-09-25" }, "en"), "12–25 Sep");
  assertEquals(rangeLabel({ preset: "custom", from: "2026-08-28", to: "2026-09-03" }, "en"), "28 Aug — 3 Sep");
  assertEquals(rangeLabel(null), "Весь срок");
  assertEquals(rangeLabel({ preset: "custom", from: "2026-09-12", to: "2026-09-25" }), "12–25 сен");
});
