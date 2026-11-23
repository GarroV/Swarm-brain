import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleUploadRecovery, type RecoveryDeps } from "./handle.ts";
import { verifyUploadRecoveryToken } from "../_shared/upload-recovery-token.ts";
const meeting = "11111111-1111-4111-8111-111111111111";
const now = 1_000_000;
const deps: RecoveryDeps = {
  identify: () => Promise.resolve({ agentId: "a", groupId: "space" }),
  lookup: () => Promise.resolve({ grantId: "g", agentId: "a", groupId: "space", telegramId: 7, meetingId: meeting }),
  secret: "test-only-recovery-key",
  now: () => now,
};
const req = () =>
  new Request("https://api.test/meeting-upload-recovery", {
    method: "POST",
    body: JSON.stringify({ person: 7, meeting_id: meeting }),
  });
Deno.test("recovery: existing scoped grant produces upload permit; no new meeting/notification", async () => {
  const r = await handleUploadRecovery(req(), deps);
  assertEquals(r.status, 200);
  const body = await r.json();
  const c = await verifyUploadRecoveryToken(
    body.upload_token,
    new Request("https://api.test/meeting-ingest", { method: "POST" }),
    deps.secret,
    now,
  );
  assertEquals(c.meetingId, meeting);
  assertEquals(c.telegramId, 7);
});
Deno.test("recovery: absent grant, foreign agent/space/person and lost access denied", async () => {
  for (const row of [null, { agentId: "other" }, { groupId: "other" }, { telegramId: 8 }, { meetingId: "other" }]) {
    const lookup: RecoveryDeps["lookup"] = async () =>
      row === null ? null : { ...(await deps.lookup({ agentId: "a", groupId: "space" }, 7, meeting))!, ...row };
    assertEquals((await handleUploadRecovery(req(), { ...deps, lookup })).status, 403);
  }
  assertEquals(
    (await handleUploadRecovery(req(), { ...deps, identify: () => Promise.reject({ status: 403 }) })).status,
    403,
  );
  assertEquals(
    (await handleUploadRecovery(req(), { ...deps, lookup: () => Promise.reject(new Error("db down")) })).status,
    503,
  );
});
