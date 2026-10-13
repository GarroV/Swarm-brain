import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  accessToken,
  dropCachedToken,
  GOOGLE_TIMEOUT_MS,
  isDeadGrantError,
  listEvents,
  type TokenCache,
} from "./google-calendar.ts";

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

// ── Кэш access-токена (issue #906): fetch и часы подменены, кэш свой на каждый тест ──────────────
function countingTokenFetch(
  expiresIn: number | undefined,
  tokens: string[],
): { calls: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (() => {
    const token = tokens[Math.min(n, tokens.length - 1)];
    n++;
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 }),
    );
  }) as typeof fetch;
  return {
    calls: () => n,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

Deno.test("accessToken cache: второй вызов в пределах TTL не ходит к Google", async () => {
  const f = countingTokenFetch(3600, ["t1", "t2"]);
  try {
    const cache: TokenCache = new Map();
    let t = 1_000;
    const a = await accessToken("r", 1000, cache, () => t);
    t += 10 * 60_000;
    const b = await accessToken("r", 1000, cache, () => t);
    assertEquals([a, b], [{ ok: true, token: "t1" }, { ok: true, token: "t1" }]);
    assertEquals(f.calls(), 1);
  } finally {
    f.restore();
  }
});

Deno.test("accessToken cache: после expires_in минус 5 минут токен обменивается заново", async () => {
  const f = countingTokenFetch(600, ["t1", "t2"]); // TTL = 600 − 300 = 5 минут
  try {
    const cache: TokenCache = new Map();
    let t = 0;
    await accessToken("r", 1000, cache, () => t);
    t = 4 * 60_000;
    assertEquals(await accessToken("r", 1000, cache, () => t), { ok: true, token: "t1" });
    t = 5 * 60_000 + 1;
    assertEquals(await accessToken("r", 1000, cache, () => t), { ok: true, token: "t2" });
    assertEquals(f.calls(), 2);
  } finally {
    f.restore();
  }
});

Deno.test("accessToken cache: TTL не больше 50 минут, разные refresh не смешиваются", async () => {
  const f = countingTokenFetch(86_400, ["t1", "t2"]);
  try {
    const cache: TokenCache = new Map();
    await accessToken("a", 1000, cache, () => 0);
    assertEquals(await accessToken("a", 1000, cache, () => 49 * 60_000), { ok: true, token: "t1" });
    assertEquals(await accessToken("a", 1000, cache, () => 51 * 60_000), { ok: true, token: "t2" });
    assertEquals(await accessToken("b", 1000, cache, () => 51 * 60_000), { ok: true, token: "t2" });
    assertEquals(f.calls(), 3); // a, a-после-срока, b
    assertEquals([...cache.keys()].some((k) => k.includes("a") && k.length < 64), false); // ключ — хеш, не токен
  } finally {
    f.restore();
  }
});

Deno.test("accessToken cache: мёртвый грант по-прежнему deadGrant и не кэшируется", async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (() => {
    n++;
    return Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
  }) as typeof fetch;
  try {
    const cache: TokenCache = new Map();
    assertEquals(await accessToken("r", 1000, cache), { ok: false, deadGrant: true });
    assertEquals(await accessToken("r", 1000, cache), { ok: false, deadGrant: true });
    assertEquals([n, cache.size], [2, 0]);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("dropCachedToken: следующий вызов снова обменивает токен", async () => {
  const f = countingTokenFetch(3600, ["t1", "t2"]);
  try {
    const cache: TokenCache = new Map();
    await accessToken("r", 1000, cache, () => 0);
    await dropCachedToken("r", cache);
    assertEquals(await accessToken("r", 1000, cache, () => 0), { ok: true, token: "t2" });
  } finally {
    f.restore();
  }
});
