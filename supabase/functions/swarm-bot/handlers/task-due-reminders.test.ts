// Запуск (из корня): deno test supabase/functions/swarm-bot/handlers/task-due-reminders.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "jsr:@std/testing@1/time";
import {
  asPingRow,
  type DueRow,
  formatDueReminders,
  isDueReminderDue,
  settleDueReminder,
} from "./task-due-reminders.ts";
import { groupByRecipient, pingSendingOpen, todayIn } from "./task-pings.ts";

const TODAY = "2026-10-15";
const TOMORROW = "2026-10-16";

const row = (over: Partial<DueRow> = {}): DueRow => ({
  id: "t1",
  title: "Отчёт по рынку",
  remind_date: null,
  due_date: TOMORROW,
  status: "open",
  assignee_telegram_ids: [111],
  created_by_telegram_id: 222,
  remind_set_by: null,
  ...over,
});

Deno.test("isDueReminderDue: срок завтра — пора", () => {
  assertEquals(isDueReminderDue(row(), TODAY), true);
});

Deno.test("isDueReminderDue: сегодняшний, просроченный и дальний срок не трогаем", () => {
  assertEquals(isDueReminderDue(row({ due_date: TODAY }), TODAY), false);
  assertEquals(isDueReminderDue(row({ due_date: "2026-10-14" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ due_date: "2026-10-17" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ due_date: null }), TODAY), false);
});

Deno.test("isDueReminderDue: «завтра» считается через границу месяца", () => {
  assertEquals(isDueReminderDue(row({ due_date: "2026-11-01" }), "2026-10-31"), true);
});

Deno.test("isDueReminderDue: закрытая и архивная задача не напоминает", () => {
  assertEquals(isDueReminderDue(row({ status: "done" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ status: "cancelled" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ archived_at: "2026-10-01T00:00:00Z" }), TODAY), false);
});

Deno.test("isDueReminderDue: одно напоминание на срок, перенос срока даёт новое", () => {
  assertEquals(isDueReminderDue(row({ due_reminded_for: TOMORROW }), TODAY), false);
  // Напомнили про 14-е, срок перенесли на 16-е — напоминаем снова.
  assertEquals(isDueReminderDue(row({ due_reminded_for: "2026-10-14" }), TODAY), true);
});

Deno.test("isDueReminderDue: ожидающий ручной пинг (в будущем или просроченный) — пропускаем", () => {
  assertEquals(isDueReminderDue(row({ remind_date: "2026-10-20", reminded_at: null }), TODAY), false);
  assertEquals(isDueReminderDue(row({ remind_date: "2026-10-10", reminded_at: null }), TODAY), false);
});

Deno.test("isDueReminderDue: пинг сработал сегодня — человек уже напомнен, пропускаем", () => {
  assertEquals(isDueReminderDue(row({ remind_date: TODAY, reminded_at: "2026-10-15T07:00:00Z" }), TODAY), false);
});

Deno.test("isDueReminderDue: пинг отработал раньше — напоминание о сроке всё равно положено", () => {
  assertEquals(isDueReminderDue(row({ remind_date: "2026-10-10", reminded_at: "2026-10-10T07:00:00Z" }), TODAY), true);
});

Deno.test("settleDueReminder: дошло всем — срок отработан; не всем — запоминаем дошедших", () => {
  const r = row({ assignee_telegram_ids: [111, 333] });
  assertEquals(settleDueReminder(r, [111, 333]), { done: true, delivered: [111, 333] });
  assertEquals(settleDueReminder(r, [111]), { done: false, delivered: [111] });
  // Следующий тик: дошло второму — вместе с прошлым тиком это все.
  const next = row({ assignee_telegram_ids: [111, 333], due_reminder_delivered_to: [111] });
  assertEquals(settleDueReminder(next, [333]), { done: true, delivered: [111, 333] });
});

Deno.test("groupByRecipient через asPingRow: дошедшим напоминание повторно не шлём", () => {
  const r = row({ assignee_telegram_ids: [111, 333], due_reminder_delivered_to: [111] });
  assertEquals([...groupByRecipient([asPingRow(r)]).keys()], [333]);
});

Deno.test("formatDueReminders: заголовок «Срок завтра», одна задача и несколько", () => {
  const one = formatDueReminders([asPingRow(row())], "https://w.example");
  assertStringIncludes(one.text, "<b>Срок завтра</b>");
  assertStringIncludes(one.text, "«Отчёт по рынку»");
  assertEquals(one.keyboard[0][0].url, "https://w.example/?task=t1");
  const many = formatDueReminders([asPingRow(row()), asPingRow(row({ id: "t2" }))], "https://w.example");
  assertStringIncludes(many.text, "<b>Срок завтра</b> по 2 задачам");
});

Deno.test("отправка: ночью (комендантский час) окно закрыто, с 9:00 по Москве открыто", () => {
  {
    using _t = new FakeTime(new Date("2026-10-15T05:30:00Z")); // 08:30 МСК
    assertEquals(pingSendingOpen(new Date()), false);
  }
  {
    using _t = new FakeTime(new Date("2026-10-15T06:30:00Z")); // 09:30 МСК, 08:30 Белград
    assertEquals(pingSendingOpen(new Date()), true);
    assertEquals(todayIn(new Date()), TODAY);
  }
});

Deno.test("isDueReminderDue: задачу, заведённую в день напоминания, не напоминаем", () => {
  // Белград в октябре UTC+2: 14.10 22:30Z — уже 00:30 15-го; 14.10 21:30Z — ещё 23:30 14-го.
  assertEquals(isDueReminderDue(row({ created_at: "2026-10-15T08:00:00Z" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ created_at: "2026-10-15T21:30:00Z" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ created_at: "2026-10-14T22:30:00Z" }), TODAY), false);
  assertEquals(isDueReminderDue(row({ created_at: "2026-10-14T21:30:00Z" }), TODAY), true);
  assertEquals(isDueReminderDue(row({ created_at: null }), TODAY), true);
});
