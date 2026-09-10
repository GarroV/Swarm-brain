import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isDeadGrantError } from "./google-calendar.ts";

Deno.test("isDeadGrantError: invalid_grant на 400 — токен реально отозван", () => {
  const body = JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." });
  assertEquals(isDeadGrantError(400, body), true);
});

Deno.test("isDeadGrantError: invalid_client на 400 — тоже реально мёртво", () => {
  const body = JSON.stringify({ error: "invalid_client" });
  assertEquals(isDeadGrantError(400, body), true);
});

Deno.test("isDeadGrantError: 429 рейт-лимит — НЕ мёртвый токен, временная запинка", () => {
  const body = JSON.stringify({ error: "rate_limit_exceeded" });
  assertEquals(isDeadGrantError(429, body), false);
});

Deno.test("isDeadGrantError: 500 от Google — НЕ мёртвый токен", () => {
  assertEquals(isDeadGrantError(500, "Internal Server Error"), false);
});

Deno.test("isDeadGrantError: 400 но другая ошибка (не invalid_grant/invalid_client) — не считаем мёртвым", () => {
  const body = JSON.stringify({ error: "invalid_request", error_description: "Missing parameter" });
  assertEquals(isDeadGrantError(400, body), false);
});

Deno.test("isDeadGrantError: пустое/битое тело — не считаем мёртвым (не домысливаем)", () => {
  assertEquals(isDeadGrantError(400, ""), false);
});
