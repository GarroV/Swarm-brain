// Ближайшие встречи главной: линия «сейчас», сопоставление записи рекордера, ближайшая со ссылкой.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { minutesUntil, nextJoinable, nowLineIndex, reviewDraftFor } from "./homeMeetings.ts";
import type { TodayMeeting } from "./api-types/meetings.ts";
import type { AgentMeeting } from "../types.ts";

const NOW = Date.parse("2026-11-09T11:40:00Z");
const at = (hhmm: string) => `2026-11-09T${hhmm}:00Z`;
const meet = (id: string, start: string, over: Partial<TodayMeeting> = {}): TodayMeeting => ({
  id, title: id, starts_at: at(start), ends_at: at(start), join_url: null, is_now: false,
  is_past: Date.parse(at(start)) < NOW, attendees: 0, on_call: false, recording: false, ...over,
});
const draft = (title: string, start: string, status: "awaiting_review" | "in_base" = "awaiting_review") =>
  ({ id: `d-${title}`, title, started_at: at(start), status }) as AgentMeeting;

Deno.test("nowLineIndex: линия встаёт перед первой ещё не начавшейся встречей", () => {
  const ms = [meet("a", "10:00"), meet("b", "14:00"), meet("c", "16:30")];
  assertEquals(nowLineIndex(ms), 1);
});

Deno.test("nowLineIndex: нет линии, если ничего не началось или всё позади", () => {
  assertEquals(nowLineIndex([meet("b", "14:00")]), null);
  assertEquals(nowLineIndex([meet("a", "10:00")]), null);
  assertEquals(nowLineIndex([meet("a", "10:00"), meet("n", "11:00", { is_now: true, is_past: false })]), null);
  assertEquals(nowLineIndex([]), null);
});

Deno.test("reviewDraftFor: совпало название и час — «вычитать»; другое название, время или статус — нет", () => {
  const m = meet("Планирование Q4", "10:00");
  assertEquals(reviewDraftFor(m, [draft("  планирование  q4 ", "10:05")])?.id, "d-  планирование  q4 ");
  assertEquals(reviewDraftFor(m, [draft("Другая", "10:00")]), null);
  assertEquals(reviewDraftFor(m, [draft("Планирование Q4", "13:00")]), null);
  assertEquals(reviewDraftFor(m, [draft("Планирование Q4", "10:00", "in_base")]), null);
  assertEquals(reviewDraftFor({ ...m, title: null }, [draft("", "10:00")]), null);
});

Deno.test("minutesUntil: до старта — минуты, после — null", () => {
  assertEquals(minutesUntil(meet("b", "14:00"), NOW), 140);
  assertEquals(minutesUntil(meet("a", "10:00"), NOW), null);
});

Deno.test("nextJoinable: первая не прошедшая со ссылкой", () => {
  const ms = [
    meet("a", "10:00", { join_url: "https://x/a" }),
    meet("b", "14:00"),
    meet("c", "16:30", { join_url: "https://x/c" }),
  ];
  assertEquals(nextJoinable(ms)?.id, "c");
  assertEquals(nextJoinable([meet("a", "10:00", { join_url: "https://x/a" })]), null);
});
