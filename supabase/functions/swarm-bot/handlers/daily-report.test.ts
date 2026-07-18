// supabase/functions/swarm-bot/handlers/daily-report.test.ts
// Запуск: deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { yesterdayWindow } from "./daily-report.ts";

Deno.test("yesterdayWindow: лето (CEST, UTC+2) — вчерашние локальные сутки в UTC", () => {
  // now = 2026-07-18 07:30 по Белграду (05:30 UTC). Вчера = 2026-07-17.
  const w = yesterdayWindow("Europe/Belgrade", new Date("2026-07-18T05:30:00Z"));
  assertEquals(w.sinceISO, "2026-07-16T22:00:00.000Z"); // 2026-07-17 00:00 +02:00
  assertEquals(w.untilISO, "2026-07-17T22:00:00.000Z"); // 2026-07-18 00:00 +02:00
  assertEquals(w.dateLabel, "17.07");
});
