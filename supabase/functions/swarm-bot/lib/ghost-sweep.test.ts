// Запуск: deno test supabase/functions/swarm-bot/lib/ghost-sweep.test.ts
//
// Сторож встреч-призраков решает одно: пуста ли встреча потому, что обработка так и не
// началась, или потому, что бот scriba её ещё пишет. Ошибка молчаливая в обе стороны:
// ложный «призрак» — идущая встреча посреди записи выглядит в интерфейсе упавшей (#549);
// ложный «жив» — брошенная встреча вечно висит «готовится». Поэтому тесты идут вперёд кода.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { botKeepsMeetingAlive, type GhostCandidate, type GhostStore, sweepGhostMeetings } from "./ghost-sweep.ts";
import { AGENT_STALE_MIN, type AgentBeat } from "./recording-watchdog.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const secondsAgo = (s: number) => new Date(NOW - s * 1000).toISOString();

const BOT_KEY = "scriba:run-1";
const botMeeting: GhostCandidate = { id: "m-bot", identity_key: BOT_KEY };
const agent = (last_seen_at: string | null, last_meeting_key: string | null): AgentBeat => ({
  id: "scriba",
  last_seen_at,
  last_meeting_key,
});

function harness(candidates: GhostCandidate[], agents: AgentBeat[], changedMeanwhile: string[] = []) {
  const marked: string[] = [];
  const store: GhostStore = {
    ghostCandidates: () => Promise.resolve(candidates),
    agentBeats: () => Promise.resolve(agents),
    markGhostFailed: (id) => {
      marked.push(id);
      return Promise.resolve(!changedMeanwhile.includes(id));
    },
  };
  return { store, marked };
}

Deno.test("длинная встреча бота со свежим heartbeat по её ключу — не призрак (#549)", async () => {
  const { store, marked } = harness([botMeeting], [agent(minutesAgo(2), BOT_KEY)]);
  const swept = await sweepGhostMeetings({ store, nowMs: NOW });
  assertEquals(marked, []);
  assertEquals(swept, 0);
});

Deno.test("бот замолчал дольше порога — его пустая встреча призрак, как раньше", async () => {
  const { store, marked } = harness([botMeeting], [agent(minutesAgo(AGENT_STALE_MIN + 1), BOT_KEY)]);
  const swept = await sweepGhostMeetings({ store, nowMs: NOW });
  assertEquals(marked, ["m-bot"]);
  assertEquals(swept, 1);
});

Deno.test("встреча рекордера человека без heartbeat бота — помечается, как раньше", async () => {
  const human: GhostCandidate = { id: "m-human", identity_key: "cal:event-42" };
  const { store, marked } = harness([human], []);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 1);
  assertEquals(marked, ["m-human"]);
});

Deno.test("живой бот на ДРУГОЙ встрече не прикрывает чужой призрак", async () => {
  const human: GhostCandidate = { id: "m-human", identity_key: "cal:event-42" };
  const { store, marked } = harness([botMeeting, human], [agent(minutesAgo(1), "scriba:run-2")]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 2);
  assertEquals(marked, ["m-bot", "m-human"]);
});

Deno.test("встреча без ключа не совпадает с ударом без ключа", async () => {
  const keyless: GhostCandidate = { id: "m-keyless", identity_key: null };
  const { store, marked } = harness([keyless], [agent(minutesAgo(1), null)]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 1);
  assertEquals(marked, ["m-keyless"]);
});

Deno.test("один из нескольких агентов пишет эту встречу — она жива", async () => {
  const other: AgentBeat = { id: "other", last_seen_at: minutesAgo(1), last_meeting_key: "scriba:run-9" };
  const { store, marked } = harness([botMeeting], [other, agent(minutesAgo(3), BOT_KEY)]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 0);
  assertEquals(marked, []);
});

Deno.test("встреча сменилась между чтением и пометкой — не считается", async () => {
  const { store, marked } = harness([botMeeting], [], ["m-bot"]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 0);
  assertEquals(marked, ["m-bot"]);
});

Deno.test("граница порога: та же, что у сторожа оборванной записи", () => {
  const limit = AGENT_STALE_MIN * 60;
  assertEquals(botKeepsMeetingAlive(botMeeting, [agent(secondsAgo(limit - 1), BOT_KEY)], NOW), true);
  assertEquals(botKeepsMeetingAlive(botMeeting, [agent(secondsAgo(limit), BOT_KEY)], NOW), true);
  assertEquals(botKeepsMeetingAlive(botMeeting, [agent(secondsAgo(limit + 1), BOT_KEY)], NOW), false);
});

Deno.test("удара не было или он нечитаем — встреча не считается живой", () => {
  assertEquals(botKeepsMeetingAlive(botMeeting, [agent(null, BOT_KEY)], NOW), false);
  assertEquals(botKeepsMeetingAlive(botMeeting, [agent("not-a-date", BOT_KEY)], NOW), false);
  assertEquals(botKeepsMeetingAlive(botMeeting, [], NOW), false);
});
