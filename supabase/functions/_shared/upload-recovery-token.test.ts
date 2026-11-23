import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mintUploadRecoveryToken, UPLOAD_RECOVERY_TTL_MS, verifyUploadRecoveryToken } from "./upload-recovery-token.ts";

const now = 1_000_000;
const secret = "test-only-upload-secret";
const claims = {
  grantId: "g",
  agentId: "a",
  groupId: "space",
  telegramId: 7,
  meetingId: "m",
  expiresAt: now + UPLOAD_RECOVERY_TTL_MS,
};
const request = (route: string, method = "POST") => new Request(`https://api.test/functions/v1/${route}`, { method });

Deno.test("recovery permit: upload/status only; claim, heartbeat and other doors denied", async () => {
  const token = await mintUploadRecoveryToken(claims, secret);
  assertEquals(await verifyUploadRecoveryToken(token, request("meeting-ingest"), secret, now), claims);
  assertEquals(await verifyUploadRecoveryToken(token, request("meeting-status", "GET"), secret, now), claims);
  for (
    const route of [
      "meeting-claim",
      "meeting-heartbeat",
      "meeting-webtoken",
      "meeting-notice",
      "meeting-upload-recovery",
    ]
  ) {
    await assertRejects(() => verifyUploadRecoveryToken(token, request(route), secret, now));
  }
});

Deno.test("recovery permit: tampering, wrong key, expiry and excessive lifetime denied", async () => {
  const token = await mintUploadRecoveryToken(claims, secret);
  await assertRejects(() => verifyUploadRecoveryToken(token + "x", request("meeting-ingest"), secret, now));
  await assertRejects(() => verifyUploadRecoveryToken(token, request("meeting-ingest"), "other", now));
  await assertRejects(() => verifyUploadRecoveryToken(token, request("meeting-ingest"), secret, claims.expiresAt));
  const excessive = await mintUploadRecoveryToken({ ...claims, expiresAt: now + UPLOAD_RECOVERY_TTL_MS + 1 }, secret);
  await assertRejects(() => verifyUploadRecoveryToken(excessive, request("meeting-ingest"), secret, now));
});
