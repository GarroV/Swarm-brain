// Запуск: deno test supabase/functions/swarm-bot/handlers/review-reminders.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatReminder,
  groupByOwner,
  isWorkingHours,
  type ReminderRow,
  selectDueReminders,
} from "./review-reminders.ts";

const row = (over: Partial<ReminderRow>): ReminderRow => ({
  id: "id",
  owner_id: 1,
  title: "Встреча",
  meetingDate: "2026-07-19",
  created_at: "2026-07-19T10:00:00.000Z",
  last_review_reminded_at: null,
  ...over,
});

Deno.test("isWorkingHours: будни 12:00 Белград — true", () => {
  // 2026-07-22 — среда. 10:00Z = 12:00 CEST.
  assertEquals(isWorkingHours(new Date("2026-07-22T10:00:00Z")), true);
});

Deno.test("isWorkingHours: ночь — false", () => {
  // 2026-07-22 04:00Z = 06:00 CEST (до 9)
  assertEquals(isWorkingHours(new Date("2026-07-22T04:00:00Z")), false);
});

Deno.test("isWorkingHours: выходной — false", () => {
  // 2026-07-25 — суббота, 12:00 CEST
  assertEquals(isWorkingHours(new Date("2026-07-25T10:00:00Z")), false);
});

Deno.test("selectDueReminders: свежая (<48ч) не берётся", () => {
  const now = new Date("2026-07-22T10:00:00Z");
  const due = selectDueReminders([row({ created_at: "2026-07-22T09:00:00Z" })], now);
  assertEquals(due.length, 0);
});

Deno.test("selectDueReminders: старая, ни разу не напоминали — берётся", () => {
  const now = new Date("2026-07-22T10:00:00Z");
  const due = selectDueReminders([row({ created_at: "2026-07-19T10:00:00Z", last_review_reminded_at: null })], now);
  assertEquals(due.length, 1);
});

Deno.test("selectDueReminders: напоминали 2ч назад — пропускаем (сутки не прошли)", () => {
  const now = new Date("2026-07-22T10:00:00Z");
  const due = selectDueReminders([row({ last_review_reminded_at: "2026-07-22T08:00:00Z" })], now);
  assertEquals(due.length, 0);
});

Deno.test("selectDueReminders: напоминали 30ч назад — снова берём", () => {
  const now = new Date("2026-07-22T10:00:00Z");
  const due = selectDueReminders([row({ last_review_reminded_at: "2026-07-21T04:00:00Z" })], now);
  assertEquals(due.length, 1);
});

Deno.test("selectDueReminders: owner_id null — не берём", () => {
  const now = new Date("2026-07-22T10:00:00Z");
  const due = selectDueReminders([row({ owner_id: null })], now);
  assertEquals(due.length, 0);
});

Deno.test("groupByOwner: группировка по владельцу", () => {
  const g = groupByOwner([row({ owner_id: 1 }), row({ owner_id: 1 }), row({ owner_id: 2 })]);
  assertEquals(g.get(1)?.length, 2);
  assertEquals(g.get(2)?.length, 1);
});

Deno.test("formatReminder: кнопки-ссылки в веб + счётчик", () => {
  const { text, keyboard } = formatReminder(
    [row({ id: "a", title: "Dodo HU", meetingDate: "2026-07-19" }), row({ id: "b", title: "1-1" })],
    "https://swarm-brain.pages.dev",
  );
  assertEquals(text.includes("2 встречи ждут"), true);
  assertEquals(keyboard.length, 2);
  assertEquals(keyboard[0][0].url, "https://swarm-brain.pages.dev/?meeting=a");
});

Deno.test("formatReminder: без webBaseUrl — без кнопок, названия в тексте", () => {
  const { text, keyboard } = formatReminder([row({ title: "Оклады BG" })], "");
  assertEquals(keyboard.length, 0);
  assertEquals(text.includes("Оклады BG"), true);
});
