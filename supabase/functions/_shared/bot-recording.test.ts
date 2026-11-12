import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { botTouchedKeys, type BotTouchedRow, recordedNowKeys } from "./bot-recording.ts";

const NOW = "2026-10-07T10:00:00.000Z";
const LIVE = "2026-10-07T10:01:00.000Z";
const GONE = "2026-10-07T09:59:00.000Z";

Deno.test("recorded_now — только встречи, которые пишутся прямо сейчас (#821)", () => {
  assertEquals(
    recordedNowKeys([
      { identity_key: "live", agent_last_recording: true, lease_expires_at: LIVE },
      { identity_key: "dead-lease", agent_last_recording: true, lease_expires_at: GONE },
      { identity_key: "stopped", agent_last_recording: false, lease_expires_at: LIVE },
      { identity_key: null, agent_last_recording: true, lease_expires_at: LIVE },
      { identity_key: "live", agent_last_recording: true, lease_expires_at: LIVE },
    ], NOW),
    ["live"],
  );
});

Deno.test("recorded_now — ключ своей строки пространства отдаётся без метки (#ws:)", () => {
  assertEquals(
    recordedNowKeys(
      [{ identity_key: "evt:2026-11-05#ws:world", agent_last_recording: true, lease_expires_at: LIVE }],
      NOW,
    ),
    ["evt:2026-11-05"],
  );
});

// «Бот трогал» (#1278): бот у двери в recorded_now не попадает, а звонок человека к его встрече липнет.
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
const row = (over: Partial<BotTouchedRow>): BotTouchedRow => ({
  identity_key: "evt:A",
  lease_expires_at: null,
  agent_last_recording: null,
  started_at: at(-10 * 60_000),
  ended_at: at(50 * 60_000),
  agent_last_seen_at: null,
  meeting_agent_grants: null,
  ...over,
});

Deno.test("bot_touched — бот у двери (пропуск привязан, не пишет) попадает", () => {
  assertEquals(
    botTouchedKeys(
      [row({ meeting_agent_grants: [{ created_at: at(-5 * 60_000) }], agent_last_recording: false })],
      NOW,
    ),
    ["evt:A"],
  );
});

Deno.test("bot_touched — бот пишет сейчас попадает", () => {
  assertEquals(
    botTouchedKeys([row({ agent_last_recording: true, lease_expires_at: LIVE, agent_last_seen_at: GONE })], NOW),
    ["evt:A"],
  );
});

Deno.test("bot_touched — встреча без бота (ни пропуска, ни ударов) не попадает", () => {
  assertEquals(botTouchedKeys([row({})], NOW), []);
});

Deno.test("bot_touched — прошедшая встреча не попадает, идущая с хвостом попадает", () => {
  const grants = [{ created_at: at(-3 * HOUR) }];
  assertEquals(
    botTouchedKeys([row({ meeting_agent_grants: grants, started_at: at(-3 * HOUR), ended_at: at(-2 * HOUR) })], NOW),
    [],
  );
  assertEquals(
    botTouchedKeys([row({ meeting_agent_grants: grants, started_at: at(-HOUR), ended_at: at(-5 * 60_000) })], NOW),
    ["evt:A"],
  );
});

Deno.test("bot_touched — ключ без метки пространства, без конца события — по умолчанию 3 часа", () => {
  assertEquals(
    botTouchedKeys([
      row({ identity_key: "evt:B#ws:world", meeting_agent_grants: [{ created_at: at(-HOUR) }], ended_at: null }),
    ], NOW),
    ["evt:B"],
  );
});
