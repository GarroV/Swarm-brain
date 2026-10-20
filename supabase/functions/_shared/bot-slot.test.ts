import { assertEquals } from "jsr:@std/assert@1";
import { BOT_PROFILE } from "./bot-profile.ts";
import { isBotRecordingNow, isMissedBotSlot } from "./bot-slot.ts";

const NOW = Date.parse("2026-10-13T13:00:00.000Z");
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

// Пустой слот бота: заявлен до захода, ничего не записано.
const slot = {
  agent_version: "scriba-2513",
  recorded_seconds: null,
  recorded_by: null,
  summary_status: null,
  agent_last_seen_at: null,
  agent_last_recording: null,
  entry_id: null,
  has_draft_notes: false,
};

Deno.test("isMissedBotSlot: бот пишет и удар свежий — слот показывается", () => {
  const row = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(1) };
  assertEquals(isMissedBotSlot(row, NOW), false);
});

Deno.test("isMissedBotSlot: бот ждёт у двери (recording=false) — прячется сразу", () => {
  const row = { ...slot, agent_last_recording: false, agent_last_seen_at: minAgo(1) };
  assertEquals(isMissedBotSlot(row, NOW), true);
  assertEquals(isMissedBotSlot(slot, NOW), true, "ударов ещё не было");
});

Deno.test("isMissedBotSlot: флаг взведён, но удар протух — прячется", () => {
  const stale = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(BOT_PROFILE.silentMinutes + 1) };
  assertEquals(isMissedBotSlot(stale, NOW), true);
  const edge = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(BOT_PROFILE.silentMinutes) };
  assertEquals(isMissedBotSlot(edge, NOW), false, "граница включительно, как у сторожей");
});

Deno.test("isMissedBotSlot: failed прячется, даже при взведённом флаге", () => {
  const row = { ...slot, summary_status: "failed", agent_last_recording: true, agent_last_seen_at: minAgo(1) };
  assertEquals(isMissedBotSlot(row, NOW), true);
});

Deno.test("isMissedBotSlot: секунды, записавший, запись в базе или тезисы — не прятать никогда", () => {
  const dead = { ...slot, summary_status: "failed" };
  assertEquals(isMissedBotSlot({ ...dead, recorded_seconds: 1010 }, NOW), false);
  assertEquals(isMissedBotSlot({ ...dead, recorded_by: "recorder" }, NOW), false);
  assertEquals(isMissedBotSlot({ ...dead, entry_id: "e1" }, NOW), false);
  assertEquals(isMissedBotSlot({ ...dead, has_draft_notes: true }, NOW), false);
});

Deno.test("isMissedBotSlot: не строка бота (рекордер человека) — не прятать", () => {
  const row = { ...slot, agent_version: "0.1.0", summary_status: "failed" };
  assertEquals(isMissedBotSlot(row, NOW), false);
  assertEquals(isMissedBotSlot({ ...slot, agent_version: null }, NOW), false);
});

Deno.test("isBotRecordingNow: бот пишет и удар свежий — идёт запись", () => {
  const row = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(1), recorded_seconds: 600 };
  assertEquals(isBotRecordingNow(row, NOW), true);
});

Deno.test("isBotRecordingNow: ждёт у двери, протухший удар или нет ударов — не запись", () => {
  assertEquals(isBotRecordingNow({ ...slot, agent_last_recording: false, agent_last_seen_at: minAgo(1) }, NOW), false);
  assertEquals(isBotRecordingNow(slot, NOW), false);
  const stale = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(BOT_PROFILE.silentMinutes + 1) };
  assertEquals(isBotRecordingNow(stale, NOW), false);
  const edge = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(BOT_PROFILE.silentMinutes) };
  assertEquals(isBotRecordingNow(edge, NOW), true, "граница включительно, как у сторожей");
});

Deno.test("isBotRecordingNow: сводка начата/готова/failed или есть тезисы — запись окончена", () => {
  const live = { ...slot, agent_last_recording: true, agent_last_seen_at: minAgo(1) };
  assertEquals(isBotRecordingNow({ ...live, summary_status: "pending" }, NOW), false);
  assertEquals(isBotRecordingNow({ ...live, summary_status: "done" }, NOW), false);
  assertEquals(isBotRecordingNow({ ...live, summary_status: "failed" }, NOW), false);
  assertEquals(isBotRecordingNow({ ...live, has_draft_notes: true }, NOW), false);
});

Deno.test("isBotRecordingNow: строка не от бота (рекордер) — не запись, даже со взведённым флагом", () => {
  const row = { ...slot, agent_version: "recorder-35", agent_last_recording: true, agent_last_seen_at: minAgo(1) };
  assertEquals(isBotRecordingNow(row, NOW), false);
});
