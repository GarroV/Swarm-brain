// Запуск: deno test supabase/functions/swarm-bot/lib/ghost-sweep.test.ts
//
// Сторож встреч-призраков решает одно: пуста ли встреча потому, что обработка так и не
// началась, или потому, что бот scriba её ещё пишет. Ошибка молчаливая в обе стороны:
// ложный «призрак» — идущая встреча посреди записи выглядит в интерфейсе упавшей (#549);
// ложный «жив» — брошенная встреча вечно висит «готовится». Поэтому тесты идут вперёд кода.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { botKeepsMeetingAlive, type GhostCandidate, type GhostStore, sweepGhostMeetings } from "./ghost-sweep.ts";
import { AGENT_STALE_MIN } from "./recording-watchdog.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const secondsAgo = (s: number) => new Date(NOW - s * 1000).toISOString();

/** Пустая встреча; agent_last_seen_at — последний удар бота по ЭТОЙ встрече (D018), null — бот её не писал. */
const meeting = (id: string, agent_last_seen_at: string | null): GhostCandidate => ({ id, agent_last_seen_at });

function harness(candidates: GhostCandidate[], changedMeanwhile: string[] = []) {
  const marked: string[] = [];
  const store: GhostStore = {
    ghostCandidates: () => Promise.resolve(candidates),
    markGhostFailed: (id) => {
      marked.push(id);
      return Promise.resolve(!changedMeanwhile.includes(id));
    },
  };
  return { store, marked };
}

Deno.test("длинная встреча бота со свежим heartbeat по ней — не призрак (#549)", async () => {
  const { store, marked } = harness([meeting("m-bot", minutesAgo(2))]);
  const swept = await sweepGhostMeetings({ store, nowMs: NOW });
  assertEquals(marked, []);
  assertEquals(swept, 0);
});

Deno.test("БЛОКИРУЮЩИЙ: две встречи бота сразу — обе живы, ни одна не призрак", async () => {
  // До D018 удар лежал в одной строке агента, и в момент обхода был виден ключ только одной
  // встречи — вторая метилась 'failed' посреди записи.
  const { store, marked } = harness([meeting("m-a", minutesAgo(1)), meeting("m-b", minutesAgo(3))]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 0);
  assertEquals(marked, []);
});

Deno.test("две встречи бота: замолчавшая — призрак, живая — нет", async () => {
  const { store, marked } = harness([
    meeting("m-alive", minutesAgo(1)),
    meeting("m-dead", minutesAgo(AGENT_STALE_MIN + 1)),
  ]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 1);
  assertEquals(marked, ["m-dead"]);
});

Deno.test("встреча рекордера человека без heartbeat бота — помечается, как раньше", async () => {
  const { store, marked } = harness([meeting("m-human", null)]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 1);
  assertEquals(marked, ["m-human"]);
});

Deno.test("встреча сменилась между чтением и пометкой — не считается", async () => {
  const { store, marked } = harness([meeting("m-bot", null)], ["m-bot"]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 0);
  assertEquals(marked, ["m-bot"]);
});

Deno.test("кандидатов нет — ноль и без пометок", async () => {
  const { store, marked } = harness([]);
  assertEquals(await sweepGhostMeetings({ store, nowMs: NOW }), 0);
  assertEquals(marked, []);
});

Deno.test("граница порога: та же, что у сторожа оборванной записи", () => {
  const limit = AGENT_STALE_MIN * 60;
  assertEquals(botKeepsMeetingAlive(meeting("m", secondsAgo(limit - 1)), NOW), true);
  assertEquals(botKeepsMeetingAlive(meeting("m", secondsAgo(limit)), NOW), true);
  assertEquals(botKeepsMeetingAlive(meeting("m", secondsAgo(limit + 1)), NOW), false);
});

Deno.test("удара не было или он нечитаем — встреча не считается живой", () => {
  assertEquals(botKeepsMeetingAlive(meeting("m", null), NOW), false);
  assertEquals(botKeepsMeetingAlive(meeting("m", "not-a-date"), NOW), false);
});
