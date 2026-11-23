import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CaptureHeartbeatJournal } from "./capture-journal.ts";

Deno.test("capture journal distinguishes accepted, stale, missed and failed writes; suppresses repeats", () => {
  const lines: string[] = [];
  const journal = new CaptureHeartbeatJournal((line) => lines.push(line));
  const bot = { kind: "bot", agentId: "scriba" };
  const body = { audio_healthy: false, meeting_id: "m1", token: "secret-not-for-log" };
  journal.record(bot, body, "ok", "t1");
  journal.record(bot, body, "ok", "t2");
  journal.record(bot, body, "stale", "t3");
  journal.record(bot, body, "missed", "t4");
  journal.record(bot, body, "failed", "t5");
  journal.record(bot, { ...body, audio_healthy: true }, "ok", "t6");
  journal.record({ kind: "human" }, body, "ok", "t7");
  journal.record(bot, { meeting_id: "m1" }, "ok", "t8");
  const events = lines.map((line) => JSON.parse(line.slice("capture-heartbeat ".length)));
  assertEquals(events.map((event) => event.writeOutcome), ["ok", "stale", "missed", "failed", "ok"]);
  assertEquals(events[4], {
    event: "capture_health_write",
    at: "t6",
    meetingId: "m1",
    agentId: "scriba",
    audioHealthy: true,
    writeOutcome: "ok",
  });
  assertFalse(lines.join("\n").includes("secret-not-for-log"));
});

Deno.test("capture journal bounds its cache without losing later incidents", () => {
  const lines: string[] = [];
  const journal = new CaptureHeartbeatJournal((line) => lines.push(line), 1);
  const bot = { kind: "bot", agentId: "scriba" };
  for (const meeting_id of ["m1", "m2", "m1"]) {
    journal.record(bot, { meeting_id, audio_healthy: false }, "ok", "t1");
  }
  assertEquals(lines.length, 3);
});
