import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordedNowKeys } from "./bot-recording.ts";

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
