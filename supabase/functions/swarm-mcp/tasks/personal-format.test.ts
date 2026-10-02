import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatCalendarGap, formatNotifications, formatTodayMeetings, localClock } from "./personal-format.ts";

const item = (id: string, read: boolean) => ({
  id,
  type: "comment",
  task_id: "T1",
  task_title: "Отчёт",
  content: "готово",
  actor_name: "Аня",
  read_at: read ? "2026-10-02T04:00:00Z" : null,
  created_at: "2026-10-02T03:15:00Z",
});

Deno.test("уведомления: счётчик непрочитанных и id в каждой строке", () => {
  const text = formatNotifications([item("n1", false), item("n2", true)], false);
  assertStringIncludes(text, "Непрочитанных: 1");
  assertStringIncludes(text, "(id: n1)");
  assertStringIncludes(text, "(id: n2)");
  assertStringIncludes(text, "Аня — «Отчёт» (задача T1): готово");
});

Deno.test("уведомления: фильтр непрочитанных и пустые ответы", () => {
  assertEquals(formatNotifications([item("n2", true)], true), "Непрочитанных уведомлений нет.");
  assertEquals(formatNotifications([], false), "Уведомлений нет.");
  assertEquals(formatNotifications([item("n1", false), item("n2", true)], true).includes("n2"), false);
});

Deno.test("время: смещение к востоку от UTC", () => {
  assertEquals(localClock("2026-10-02T07:30:00Z", 120), "09:30");
  assertEquals(localClock("2026-10-02T23:30:00Z", 60), "00:30");
});

Deno.test("встречи: с кем, ссылка, пометка про UTC без пояса", () => {
  const m = {
    id: "e1",
    title: "Синк",
    starts_at: "2026-10-02T07:00:00Z",
    ends_at: "2026-10-02T07:30:00Z",
    join_url: "https://meet.google.com/x",
    is_now: false,
    is_past: false,
    attendees: 2,
    on_call: false,
    recording: false,
  };
  const text = formatTodayMeetings([m], new Map([["e1", ["Аня", "bob@x.io"]]]), 0, false);
  assertStringIncludes(text, "• 07:00–07:30 Синк");
  assertStringIncludes(text, "С кем: Аня, bob@x.io");
  assertStringIncludes(text, "Ссылка: https://meet.google.com/x");
  assertStringIncludes(text, "Время в UTC");
  assertEquals(formatTodayMeetings([m], new Map(), 120, true).includes("UTC"), false);
  assertEquals(formatTodayMeetings([], new Map(), 0, true), "На сегодня встреч в календаре нет.");
});

Deno.test("календарь: причины пустоты различаются", () => {
  const texts = new Set(["not_connected", "token_expired", "calendar_error"].map((r) => formatCalendarGap(r as never)));
  assertEquals(texts.size, 3);
});
