import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backupAvailableKeys, botStillRecording, recordedNowKeys, type RecordedNowRow } from "./bot-recording.ts";
const now = "2026-11-23T12:00:00Z";
const row: RecordedNowRow = {
  identity_key: "call",
  agent_last_recording: true,
  lease_expires_at: "2026-11-23T12:30:00Z",
};
Deno.test("backup offer: capture failure does not release the bot claim/lease or hide its presence", () => {
  const failed = { ...row, agent_last_audio_healthy: false };
  assertEquals(botStillRecording(failed, now), true);
  assertEquals(recordedNowKeys([failed], now), ["call"]);
  assertEquals(backupAvailableKeys([failed], now), ["call"]);
  assertEquals(backupAvailableKeys([{ ...failed, agent_last_audio_healthy: true }], now), []);
});
Deno.test("backup offer: unknown health, other healthy calls and stopped bots do not trigger it", () => {
  assertEquals(
    backupAvailableKeys([row, { ...row, identity_key: "healthy", agent_last_audio_healthy: true }], now),
    [],
  );
  assertEquals(
    backupAvailableKeys([{ ...row, agent_last_recording: false, agent_last_audio_healthy: false }], now),
    [],
  );
  assertEquals(
    backupAvailableKeys([{ ...row, lease_expires_at: "2026-11-23T11:00:00Z", agent_last_audio_healthy: false }], now),
    [],
  );
});
