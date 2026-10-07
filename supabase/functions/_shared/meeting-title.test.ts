import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { defaultMeetingTitle, displayNameOf, isDefaultMeetingTitle } from "./meeting-title.ts";

Deno.test("displayNameOf: имя из профиля важнее username", () => {
  assertEquals(displayNameOf({ first_name: "Вадим", last_name: "Гарро", username: "garro" }), "Вадим Гарро");
  assertEquals(displayNameOf({ first_name: "Вадим", username: "garro" }), "Вадим");
});

Deno.test("displayNameOf: профиль пуст → username", () => {
  assertEquals(displayNameOf({ username: "garro" }), "garro");
  assertEquals(displayNameOf({ first_name: "  ", last_name: null, username: "garro" }), "garro");
});

Deno.test("displayNameOf: не знаем ничего → null, а не пустая строка", () => {
  assertEquals(displayNameOf({}), null);
  assertEquals(displayNameOf({ first_name: "", username: "   " }), null);
});

Deno.test("defaultMeetingTitle: имя + дата и время начала по Белграду", () => {
  // 12:01 UTC в августе = 14:01 в Белграде (UTC+2)
  assertEquals(defaultMeetingTitle("Вадим", "2026-08-26T12:01:36+00:00"), "Вадим — 26.08, 14:01");
});

Deno.test("defaultMeetingTitle: зимой смещение другое (UTC+1)", () => {
  assertEquals(defaultMeetingTitle("Вадим", "2026-01-15T12:00:00Z"), "Вадим — 15.01, 13:00");
});

Deno.test("defaultMeetingTitle: имени нет → «Запись», а не пустое тире", () => {
  assertEquals(defaultMeetingTitle(null, "2026-08-26T12:01:36Z"), "Запись — 26.08, 14:01");
});

Deno.test("defaultMeetingTitle: времени нет → берём момент вызова", () => {
  const at = new Date("2026-08-26T12:01:36Z");
  assertEquals(defaultMeetingTitle("Аня", null, at), "Аня — 26.08, 14:01");
  assertEquals(defaultMeetingTitle("Аня", "не-дата", at), "Аня — 26.08, 14:01");
});

Deno.test("defaultMeetingTitle: длинное имя не раздувает заголовок", () => {
  const title = defaultMeetingTitle("Ы".repeat(200), "2026-08-26T12:01:36Z");
  assertEquals(title.length <= 60, true, `слишком длинно: ${title.length}`);
  assertEquals(title.endsWith("— 26.08, 14:01"), true, title);
});

Deno.test("isDefaultMeetingTitle: заглушка «имя — дата» с началом встречи опознаётся", () => {
  const started = "2026-10-05T08:00:00Z"; // 10:00 по Белграду
  assertEquals(isDefaultMeetingTitle(defaultMeetingTitle("Aleksandra Mironova", started), started), true);
  assertEquals(isDefaultMeetingTitle("Запись — 05.10, 10:00", started), true);
});

Deno.test("isDefaultMeetingTitle: настоящее название и чужая дата — не заглушка", () => {
  const started = "2026-10-05T08:00:00Z";
  assertEquals(isDefaultMeetingTitle("Синк по документам GDPR", started), false);
  // Хвост от другого времени — не наша заглушка (встречу могли перенести, а название — правили).
  assertEquals(isDefaultMeetingTitle("Aleksandra Mironova — 05.10, 11:00", started), false);
  assertEquals(isDefaultMeetingTitle(" — 05.10, 10:00", started), false);
  assertEquals(isDefaultMeetingTitle(null, started), false);
  assertEquals(isDefaultMeetingTitle("Aleksandra Mironova — 05.10, 10:00", null), false);
});
