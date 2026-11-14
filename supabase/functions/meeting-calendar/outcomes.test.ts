// Исходы «не пойдёт» опроса календаря (#1244): ключ события, а у причин человека — час.
import { assertEquals } from "@std/assert";
import { outcomesFromSkips } from "./outcomes.ts";

Deno.test("исходы: «не пойдёт» календаря — ключ события, а у причин человека — час", () => {
  const rows = outcomesFromSkips("g", [
    { invited_by: 7, calendar_key: "k:2026-11-13", title: null, reason: "declined" },
    { invited_by: 7, calendar_key: null, title: null, reason: "calendar_unavailable" },
  ], Date.parse("2026-11-13T13:24:10Z"));
  assertEquals(rows.map((r) => [r.outcome, r.outcome_key, r.source]), [
    ["declined", "k:2026-11-13", "calendar"],
    ["calendar_unavailable", "person:2026-11-13T13", "calendar"],
  ]);
});
