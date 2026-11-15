import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ADDRESS_CALLS_PER_WINDOW,
  bodyTooLargeResponse,
  clientAddress,
  RATE_LIMIT_ERROR_CODE,
  rateLimitedResponse,
  type RateSink,
  readBodyLimited,
  takeAddressRate,
  takeTokenRate,
  TOKEN_CALLS_PER_WINDOW,
} from "./limits.ts";

const post = (body: BodyInit, headers: HeadersInit = {}) => new Request("http://x/", { method: "POST", body, headers });

Deno.test("readBodyLimited: small body passes", async () => {
  assertEquals(await readBodyLimited(post('{"a":1}')), { kind: "ok", text: '{"a":1}' });
});

Deno.test("readBodyLimited: declared Content-Length over the limit is refused without reading", async () => {
  const req = post("x", { "content-length": "999999999" });
  assertEquals((await readBodyLimited(req, 100)).kind, "too_large");
});

Deno.test("readBodyLimited: stream is cut at the limit even when Content-Length lies or is absent", async () => {
  const chunk = new Uint8Array(60);
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      if (pulled > 50) return controller.close();
      controller.enqueue(chunk);
    },
  });
  const req = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assertEquals((await readBodyLimited(req, 100)).kind, "too_large");
  assertEquals(pulled < 10, true);
});

Deno.test("readBodyLimited: body exactly at the limit passes", async () => {
  assertEquals((await readBodyLimited(post("a".repeat(100)), 100)).kind, "ok");
});

Deno.test("clientAddress prefers cf-connecting-ip, else the last forwarded hop (not the client-supplied first)", () => {
  assertEquals(
    clientAddress(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 2.2.2.2" })),
    "1.1.1.1",
  );
  assertEquals(clientAddress(new Headers({ "x-forwarded-for": "9.9.9.9, 2.2.2.2" })), "2.2.2.2");
  assertEquals(clientAddress(new Headers()), "unknown");
});

function sink(result: { data: unknown; error: { code?: string } | null }) {
  const calls: Record<string, unknown>[] = [];
  const s: RateSink = { rpc: (_n, args) => (calls.push(args), Promise.resolve(result)) };
  return { s, calls };
}

Deno.test("takeTokenRate / takeAddressRate pass the agreed limits and hashed bucket keys", async () => {
  const a = sink({ data: true, error: null });
  assertEquals(await takeTokenRate(a.s, "ab".repeat(32)), true);
  assertEquals(a.calls[0].p_limit, TOKEN_CALLS_PER_WINDOW);
  assertEquals(String(a.calls[0].p_bucket).startsWith("mcp:tok:"), true);
  assertEquals(await takeAddressRate(a.s, new Headers({ "cf-connecting-ip": "1.2.3.4" })), true);
  assertEquals(a.calls[1].p_limit, ADDRESS_CALLS_PER_WINDOW);
  assertEquals(String(a.calls[1].p_bucket).includes("1.2.3.4"), false);
});

Deno.test("a refusal from the counter blocks; a counter failure does not", async () => {
  assertEquals(await takeTokenRate(sink({ data: false, error: null }).s, "t"), false);
  assertEquals(await takeTokenRate(sink({ data: null, error: { code: "XX" } }).s, "t"), true);
});

Deno.test("limit responses: 413 and 429 with Retry-After and JSON-RPC error codes", async () => {
  const big = bodyTooLargeResponse();
  assertEquals(big.status, 413);
  assertEquals((await big.json()).error.code, -32600);
  const slow = rateLimitedResponse(5);
  assertEquals(slow.status, 429);
  assertEquals(slow.headers.get("Retry-After"), "60");
  const body = await slow.json();
  assertEquals([body.id, body.error.code], [5, RATE_LIMIT_ERROR_CODE]);
});
