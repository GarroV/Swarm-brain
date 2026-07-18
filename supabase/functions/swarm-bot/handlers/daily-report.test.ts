// supabase/functions/swarm-bot/handlers/daily-report.test.ts
// Запуск: deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregateActivity, type EntryRow, yesterdayWindow } from "./daily-report.ts";

Deno.test("yesterdayWindow: лето (CEST, UTC+2) — вчерашние локальные сутки в UTC", () => {
  // now = 2026-07-18 07:30 по Белграду (05:30 UTC). Вчера = 2026-07-17.
  const w = yesterdayWindow("Europe/Belgrade", new Date("2026-07-18T05:30:00Z"));
  assertEquals(w.sinceISO, "2026-07-16T22:00:00.000Z"); // 2026-07-17 00:00 +02:00
  assertEquals(w.untilISO, "2026-07-17T22:00:00.000Z"); // 2026-07-18 00:00 +02:00
  assertEquals(w.dateLabel, "17.07");
});

Deno.test("aggregateActivity: счётчики по воркспейсам и источникам", () => {
  const rows: EntryRow[] = [
    { entry_type: "meeting", source: "desktop-agent", group_id: "cee" },
    { entry_type: "meeting", source: "granola", group_id: "cee" },
    { entry_type: "meeting", source: "granola", group_id: "other" },
    { entry_type: "note", source: "telegram", group_id: "cee" },
    { entry_type: "note", source: "link", group_id: "cee" },
    { entry_type: "note", source: "voice", group_id: "other" },
  ];
  const r = aggregateActivity(rows);
  assertEquals(r.meetings.total, 3);
  assertEquals(r.meetings.byWorkspace, { CEE: 2, OTHER: 1 });
  assertEquals(r.meetings.bySource, { "рекордер": 1, granola: 2 });
  assertEquals(r.notes.total, 3);
  assertEquals(r.notes.byWorkspace, { CEE: 2, OTHER: 1 });
  assertEquals(r.notes.bySource, { "💬 чат": 1, "🔗 ссылки": 1, "🎤 голосовые": 1 });
});

Deno.test("aggregateActivity: неизвестный source заметки → 📦 прочее; null group_id → Без воркспейса", () => {
  const r = aggregateActivity([
    { entry_type: "note", source: "weird", group_id: null },
  ]);
  assertEquals(r.notes.bySource, { "📦 прочее": 1 });
  assertEquals(r.notes.byWorkspace, { "Без воркспейса": 1 });
});
