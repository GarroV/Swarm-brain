import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accessToken, GOOGLE_TIMEOUT_MS, isDeadGrantError, listEvents } from "./google-calendar.ts";

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

// Висящий Google не должен держать вызывающего: без срока один завис — и обход автозапуска всего
// воркспейса ждёт его (Promise.all по людям). Подмена fetch отвечает только на отмену сигналом.
function hangingFetch(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

Deno.test("accessToken: Google завис — отказ-запинка по сроку, а не вечное ожидание", async () => {
  const restore = hangingFetch();
  try {
    const res = await accessToken("refresh", 20);
    assertEquals(res, { ok: false, deadGrant: false });
  } finally {
    restore();
  }
});

Deno.test("listEvents: Google завис — null по сроку, как любая ошибка Google", async () => {
  const restore = hangingFetch();
  try {
    assertEquals(await listEvents("token", "2026-09-28T10:00:00Z", "2026-09-28T11:00:00Z", 25, 20), null);
  } finally {
    restore();
  }
});

Deno.test("accessToken/listEvents: обрыв сети — отказ-запинка, а не исключение наверх", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("connection reset"))) as typeof fetch;
  try {
    assertEquals(await accessToken("refresh"), { ok: false, deadGrant: false });
    assertEquals(await listEvents("token", "2026-09-28T10:00:00Z", "2026-09-28T11:00:00Z"), null);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("GOOGLE_TIMEOUT_MS: два вызова Google подряд укладываются в ожидание оркестратора (30 с)", () => {
  // Обход автозапуска на человека — обмен токена и список событий подряд; оркестратор ждёт ответа
  // meeting-calendar 30 с (bot/src/orchestrator/calendar-client.ts). Иначе срок ничего не спасает.
  assertEquals(GOOGLE_TIMEOUT_MS > 0 && GOOGLE_TIMEOUT_MS * 2 < 30_000, true);
});
