// Панель «Встречи сегодня» (issue #218).
import { assertEquals } from "jsr:@std/assert";
import { todayMeetings, dayBounds, type RecorderPresence } from "./meetings-today.ts";
import type { GEvent } from "../meeting-current/select.ts";

const NOW = new Date("2026-09-03T12:00:00Z");
const link = (e: GEvent) => e.hangoutLink ?? null;
const ev = (over: Partial<GEvent> & { id: string }): GEvent => ({
  summary: "Встреча",
  status: "confirmed",
  start: { dateTime: "2026-09-03T11:00:00Z" },
  end: { dateTime: "2026-09-03T11:30:00Z" },
  ...over,
});

Deno.test("события дня идут по времени начала", () => {
  const out = todayMeetings([
    ev({ id: "b", start: { dateTime: "2026-09-03T15:00:00Z" }, end: { dateTime: "2026-09-03T16:00:00Z" } }),
    ev({ id: "a", start: { dateTime: "2026-09-03T09:00:00Z" }, end: { dateTime: "2026-09-03T10:00:00Z" } }),
  ], NOW, link);
  assertEquals(out.map((m) => m.id), ["a", "b"]);
});

Deno.test("отменённые, «свободен» и события на весь день — не встречи", () => {
  const out = todayMeetings([
    ev({ id: "cancelled", status: "cancelled" }),
    ev({ id: "ooo", transparency: "transparent" }),
    ev({ id: "birthday", start: { date: "2026-09-03" }, end: { date: "2026-09-04" } }),
    ev({ id: "real" }),
  ], NOW, link);
  assertEquals(out.map((m) => m.id), ["real"]);
});

Deno.test("«идёт сейчас» и «уже прошла» считаются по границам слота", () => {
  const out = todayMeetings([
    ev({ id: "now", start: { dateTime: "2026-09-03T11:45:00Z" }, end: { dateTime: "2026-09-03T12:30:00Z" } }),
    ev({ id: "past", start: { dateTime: "2026-09-03T09:00:00Z" }, end: { dateTime: "2026-09-03T10:00:00Z" } }),
    ev({ id: "future", start: { dateTime: "2026-09-03T14:00:00Z" }, end: { dateTime: "2026-09-03T15:00:00Z" } }),
  ], NOW, link);
  const byId = Object.fromEntries(out.map((m) => [m.id, m]));
  assertEquals([byId.now.is_now, byId.now.is_past], [true, false]);
  assertEquals([byId.past.is_now, byId.past.is_past], [false, true]);
  assertEquals([byId.future.is_now, byId.future.is_past], [false, false]);
});

Deno.test("себя в участниках не считаем", () => {
  const out = todayMeetings([ev({
    id: "x",
    attendees: [{ self: true, email: "me@x" }, { email: "a@x" }, { email: "b@x" }],
  })], NOW, link);
  assertEquals(out[0].attendees, 2);
});

Deno.test("ссылка на звонок берётся переданным извлекателем, без своей копии правила", () => {
  const out = todayMeetings([ev({ id: "x", hangoutLink: "https://meet.example/abc" })], NOW, link);
  assertEquals(out[0].join_url, "https://meet.example/abc");
});

Deno.test("границы дня считаются в поясе пользователя, а не сервера", () => {
  // Белград летом = UTC+2 → сутки локально начинаются в 22:00 UTC предыдущего дня.
  const { timeMin, timeMax } = dayBounds("2026-09-03T12:00:00Z", 120);
  assertEquals(timeMin, "2026-09-02T22:00:00.000Z");
  assertEquals(timeMax.slice(0, 16), "2026-09-03T21:59");
});

Deno.test("для UTC-пояса границы совпадают с календарными сутками", () => {
  const { timeMin } = dayBounds("2026-09-03T12:00:00Z", 0);
  assertEquals(timeMin, "2026-09-03T00:00:00.000Z");
});

// ── ON AIR: «ты сам в этом звонке» (решение владельца 04.09.2026) ─────────────
// Присутствие приходит из heartbeat рекордера: on_call (вход микрофона держит другое
// приложение) и recording (пишем) — два независимых факта, см.
// docs/decisions/2026-09-04-on-air-v-panele-vstrech.md.
const presence = (over: Partial<RecorderPresence> = {}): RecorderPresence => ({
  meetingKey: "x:2026-09-03",
  onCall: true,
  recording: false,
  lastSeen: NOW.toISOString(),
  ...over,
});

Deno.test("без данных о присутствии флаги не зажигаются", () => {
  const out = todayMeetings([ev({ id: "x" })], NOW, link, null);
  assertEquals([out[0].on_call, out[0].recording], [false, false]);
});

Deno.test("ON AIR горит только у встречи, чей ключ назвал рекордер", () => {
  const out = todayMeetings([
    ev({ id: "x", start: { dateTime: "2026-09-03T11:45:00Z" }, end: { dateTime: "2026-09-03T12:30:00Z" } }),
    ev({ id: "y", start: { dateTime: "2026-09-03T11:45:00Z" }, end: { dateTime: "2026-09-03T12:30:00Z" } }),
  ], NOW, link, presence());
  const byId = Object.fromEntries(out.map((m) => [m.id, m]));
  assertEquals([byId.x.on_call, byId.y.on_call], [true, false]);
});

Deno.test("протухший heartbeat не зажигает ON AIR", () => {
  // Пока звонок идёт, рекордер шлёт keep-alive раз в 2 минуты. Тишина дольше пяти минут —
  // это спящий ноут или отвалившаяся сеть, а не «человек всё ещё в звонке».
  const stale = new Date(NOW.getTime() - 6 * 60_000).toISOString();
  const out = todayMeetings([ev({ id: "x" })], NOW, link, presence({ lastSeen: stale }));
  assertEquals([out[0].on_call, out[0].recording], [false, false]);
});

Deno.test("звонок без записи: ON AIR горит, REC нет", () => {
  const out = todayMeetings([ev({ id: "x" })], NOW, link, presence({ recording: false }));
  assertEquals([out[0].on_call, out[0].recording], [true, false]);
});

Deno.test("запись зажигает и ON AIR, и REC", () => {
  const out = todayMeetings([ev({ id: "x" })], NOW, link, presence({ recording: true }));
  assertEquals([out[0].on_call, out[0].recording], [true, true]);
});

Deno.test("затянувшаяся встреча остаётся ON AIR после конца слота", () => {
  // Слот кончился, но рекордер всё ещё видит этот звонок — значит люди говорят. Гасить
  // строку как «прошедшую» нельзя: ограничение по времени даёт сам рекордер (окно ±10 мин
  // у meeting-current), сервер проверяет только свежесть heartbeat.
  const out = todayMeetings([ev({
    id: "x", start: { dateTime: "2026-09-03T10:30:00Z" }, end: { dateTime: "2026-09-03T11:55:00Z" },
  })], NOW, link, presence());
  assertEquals([out[0].is_past, out[0].on_call], [true, true]);
});

Deno.test("ключ без даты не считается совпадением", () => {
  // identity_key рекордера — «<uid>:<дата>»; сравнение по одному uid склеило бы серию
  // повторяющихся встреч в одну и зажгло ON AIR на вчерашнем экземпляре.
  const out = todayMeetings([ev({ id: "x" })], NOW, link, presence({ meetingKey: "x" }));
  assertEquals(out[0].on_call, false);
});
