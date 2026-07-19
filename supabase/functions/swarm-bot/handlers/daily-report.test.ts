// supabase/functions/swarm-bot/handlers/daily-report.test.ts
// Запуск: deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregateActivity, formatReport, type EntryRow, yesterdayWindow } from "./daily-report.ts";

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
  assertEquals(r.notes.total, 1);
});

Deno.test("aggregateActivity: заметки — файлы по имени/типу, mini_app→чат, unknown→прочее", () => {
  const r = aggregateActivity([
    { entry_type: "note", source: "IMF_Analytics.xlsx", group_id: "cee" },
    { entry_type: "note", source: "pdf", group_id: "cee" },
    { entry_type: "note", source: "image", group_id: "other" },
    { entry_type: "note", source: "mini_app", group_id: "cee" },
    { entry_type: "note", source: "link", group_id: "cee" },
    { entry_type: "note", source: "voice", group_id: "cee" },
    { entry_type: "note", source: "pyrus_ticket_bulgaria", group_id: "other" },
  ]);
  assertEquals(r.notes.total, 7);
  assertEquals(r.notes.bySource, {
    "📄 файлы": 3,
    "💬 чат": 1,
    "🔗 ссылки": 1,
    "🎤 голосовые": 1,
    "📦 прочее": 1,
  });
});

Deno.test("aggregateActivity: неизвестный источник встречи → 📦 прочее (не сырьё)", () => {
  const r = aggregateActivity([
    { entry_type: "meeting", source: "Встреча Сербия 06.05", group_id: "cee" },
    { entry_type: "meeting", source: "granola", group_id: "cee" },
  ]);
  assertEquals(r.meetings.bySource, { "📦 прочее": 1, granola: 1 });
});

Deno.test("yesterdayWindow: осенний переход (fall-back, 25-часовые сутки)", () => {
  // now = 2026-10-26 09:00 UTC (после fall-back). Вчера = 2026-10-25 (25ч).
  const w = yesterdayWindow("Europe/Belgrade", new Date("2026-10-26T09:00:00Z"));
  assertEquals(w.sinceISO, "2026-10-24T22:00:00.000Z"); // 25 окт 00:00 CEST(+02)
  assertEquals(w.untilISO, "2026-10-25T23:00:00.000Z"); // 26 окт 00:00 CET(+01) — окно 25ч
  assertEquals(w.dateLabel, "25.10");
});

Deno.test("formatReport: штатный день — обе секции с разбивкой", () => {
  const data = aggregateActivity([
    { entry_type: "meeting", source: "desktop-agent", group_id: "cee" },
    { entry_type: "note", source: "telegram", group_id: "cee" },
    { entry_type: "note", source: "link", group_id: "other" },
  ]);
  const s = formatReport(data, "18.07");
  assertEquals(s.includes("Встречи: 1"), true);
  assertEquals(s.includes("Новые данные: 2"), true);
  assertEquals(s.includes("CEE 1"), true);
  assertEquals(s.includes("🔗 ссылки 1"), true);
});

Deno.test("formatReport: секция с нулём — без подстрок", () => {
  const data = aggregateActivity([
    { entry_type: "note", source: "telegram", group_id: "cee" },
  ]);
  const s = formatReport(data, "18.07");
  assertEquals(s.includes("Встречи: 0"), true);
  // после «Встречи: 0» сразу идёт секция «Новые данные» — подстрок у нуля нет
  assertEquals(/Встречи: 0<\/b>\n\n/.test(s), true);
});

Deno.test("formatReport: тихий день — плашка, без секций", () => {
  const s = formatReport(aggregateActivity([]), "18.07");
  assertEquals(s.includes("тихий день"), true);
  assertEquals(s.includes("Встречи:"), false);
});
