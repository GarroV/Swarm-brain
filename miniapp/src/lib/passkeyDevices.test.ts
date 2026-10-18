import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deviceLinkUrl,
  encodePending,
  enrollFailure,
  PENDING_TTL_MS,
  readPending,
  tokenFromHash,
} from "./passkeyDevices.ts";

const TOKEN = "A".repeat(42) + "_";

Deno.test("ссылка: токен во фрагменте, читается обратно; мусор — null", () => {
  const url = deviceLinkUrl("https://swarm-team.app", TOKEN);
  assertEquals(url, `https://swarm-team.app/add-device#t=${TOKEN}`);
  assertEquals(tokenFromHash(new URL(url).hash), TOKEN);
  assertEquals(tokenFromHash("#t=short"), null);
  assertEquals(tokenFromHash(""), null);
  assertEquals(tokenFromHash(`#t=${TOKEN}<script>`), null);
});

Deno.test("токен ждёт входа 10 минут, потом забывается", () => {
  const raw = encodePending(TOKEN, 1000);
  assertEquals(readPending(raw, 1000 + PENDING_TTL_MS - 1), TOKEN);
  assertEquals(readPending(raw, 1000 + PENDING_TTL_MS), null);
  assertEquals(readPending("{bad", 0), null);
  assertEquals(readPending(null, 0), null);
});

Deno.test("неудачи: 410 — ссылка недействительна; ключ уже есть; отмена окна; провал приёма гасит ссылку", () => {
  assertEquals(enrollFailure("options", 410), "invalid");
  assertEquals(enrollFailure("options", 502), "failed");
  assertEquals(enrollFailure("device", 0, "InvalidStateError"), "exists");
  assertEquals(enrollFailure("device", 0, "NotAllowedError"), "cancelled");
  assertEquals(enrollFailure("verify", 401), "invalid");
});
