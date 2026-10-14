// Второй шаг входа на CF Pages (`functions/api/auth/passkey/*`, #955): куку с отметкой «шаг пройден»
// получает ровно тот, кто прошёл проверку, и ровно на своей сессии; вход и «выйти везде» не страдают.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { onRequestPost as verify } from "../../functions/api/auth/passkey/verify.ts";
import { onRequestPost as options } from "../../functions/api/auth/passkey/options.ts";
import { signJWT, verifyJWT } from "../../functions/_lib/jwt.ts";

const SECRET = "pages-secret";
const ORIGIN = "https://swarm-team.app";
const env = { WEB_JWT_SECRET: SECRET, SWARM_API_URL: "https://api.example/functions/v1/swarm-api" };

type Calls = { url: string; body: Record<string, unknown> | null }[];

/** Подменяет fetch: /me отвечает `me`, auth-passkey — `passkey`. */
function stubFetch(me: { status: number; applies?: boolean }, passkey: { status: number; body: unknown }): Calls {
  const calls: Calls = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (url.endsWith("/swarm-api/me")) {
      return Promise.resolve(
        new Response(JSON.stringify({ second_step: { applies: me.applies ?? true } }), { status: me.status }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(passkey.body), { status: passkey.status }));
  }) as typeof fetch;
  return calls;
}

async function req(path: string, body: unknown, opts: { cookie?: string; origin?: string | null } = {}): Promise<Request> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.cookie !== undefined) headers.set("Cookie", opts.cookie);
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const session = async (tid: number, authTime: number) =>
  `roj_session=${await signJWT({ telegram_id: tid, auth_time: authTime }, SECRET)}`;

const sessionFrom = (res: Response) => /roj_session=([^;]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1] ?? null;

Deno.test("verify: ключ принят — кука переиздана на того же человека, момент входа прежний, метка есть", async () => {
  const calls = stubFetch({ status: 200 }, { status: 200, body: { ok: true, mode: "get" } });
  const res = await verify({ request: await req("/api/auth/passkey/verify", { credential: { id: "x" } }, { cookie: await session(42, 1_700_000_000) }), env });
  assertEquals(res.status, 200);
  const claims = await verifyJWT(sessionFrom(res)!, SECRET);
  assertEquals([claims?.telegram_id, claims?.authTime, claims?.secondStep], [42, 1_700_000_000, true]);
  // Человека называет сессия, а не тело запроса; origin — адрес самой страницы.
  const passkeyCall = calls.find((c) => c.url.endsWith("/auth-passkey"))!;
  assertEquals([passkeyCall.body?.telegram_id, passkeyCall.body?.origin, passkeyCall.body?.op], [42, ORIGIN, "finish"]);
});

Deno.test("verify: шаг не прошёл — куки нет, отказ одинаковый, сессия остаётся прежней", async () => {
  stubFetch({ status: 200 }, { status: 401, body: { ok: false, reason: "failed" } });
  const res = await verify({ request: await req("/api/auth/passkey/verify", { credential: { id: "x" } }, { cookie: await session(42, 1_700_000_000) }), env });
  assertEquals([res.status, res.headers.get("Set-Cookie")], [401, null]);
});

Deno.test("verify: чужой Origin, нет сессии, битая подпись — отказ до звонка в auth-passkey", async () => {
  const calls = stubFetch({ status: 200 }, { status: 200, body: { ok: true } });
  const cookie = await session(42, 1_700_000_000);
  const body = { credential: { id: "x" } };
  assertEquals((await verify({ request: await req("/api/auth/passkey/verify", body, { cookie, origin: "https://evil.example" }), env })).status, 403);
  assertEquals((await verify({ request: await req("/api/auth/passkey/verify", body, { cookie, origin: null }), env })).status, 403);
  assertEquals((await verify({ request: await req("/api/auth/passkey/verify", body, {}), env })).status, 401);
  assertEquals((await verify({ request: await req("/api/auth/passkey/verify", body, { cookie: "roj_session=a.b.c" }), env })).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("verify: отозванная сессия (swarm-api сказал 401), демо и короткий токен шаг не получают", async () => {
  const cookie = await session(42, 1_700_000_000);
  const body = { credential: { id: "x" } };
  let calls = stubFetch({ status: 401 }, { status: 200, body: { ok: true } });
  assertEquals((await verify({ request: await req("/api/auth/passkey/verify", body, { cookie }), env })).status, 401);
  assertEquals(calls.some((c) => c.url.endsWith("/auth-passkey")), false);

  calls = stubFetch({ status: 200, applies: false }, { status: 200, body: { ok: true } });
  assertEquals((await verify({ request: await req("/api/auth/passkey/verify", body, { cookie }), env })).status, 403);
  assertEquals(calls.some((c) => c.url.endsWith("/auth-passkey")), false);

  // Короткий (12 часов) токен веб-доступа не превращаем в 30-дневную сессию.
  const short = `roj_session=${await signJWT({ telegram_id: 42 }, SECRET, 12 * 3600)}`;
  calls = stubFetch({ status: 200 }, { status: 200, body: { ok: true } });
  const res = await verify({ request: await req("/api/auth/passkey/verify", body, { cookie: short }), env });
  assertEquals([res.status, res.headers.get("Set-Cookie")], [403, null]);
  assertEquals(calls.length, 0);
});

Deno.test("options: режим и параметры от auth-passkey проходят как есть, here передаётся, сессию не трогает", async () => {
  const calls = stubFetch({ status: 200 }, { status: 200, body: { ok: true, mode: "get", options: { challenge: "c" } } });
  const res = await options({ request: await req("/api/auth/passkey/options", { here: true }, { cookie: await session(7, 1_700_000_000) }), env });
  assertEquals([res.status, res.headers.get("Set-Cookie")], [200, null]);
  assertEquals((await res.json()).mode, "get");
  const c = calls.find((x) => x.url.endsWith("/auth-passkey"))!;
  assertEquals([c.body?.op, c.body?.here, c.body?.telegram_id], ["start", true, 7]);
});

Deno.test("вызов auth-passkey подписан HMAC на тот же секрет, что у auth-resolve", async () => {
  let sig = "";
  let raw = "";
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    if (String(input).endsWith("/swarm-api/me")) return Promise.resolve(new Response(JSON.stringify({ second_step: { applies: true } })));
    sig = (init?.headers as Record<string, string>)["x-sig"];
    raw = String(init?.body);
    return Promise.resolve(new Response(JSON.stringify({ ok: true, mode: "create", options: {} })));
  }) as typeof fetch;
  await options({ request: await req("/api/auth/passkey/options", { here: false }, { cookie: await session(7, 1_700_000_000) }), env });
  const { hmacSign } = await import("../../functions/_lib/oauth-state.ts");
  assertEquals(sig, await hmacSign(SECRET, raw));
});
