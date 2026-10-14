import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePasskeyRequest, type HandlerDeps, hmacHex } from "./handler.ts";
import { MemoryStore } from "../_shared/passkeys/memory-store.ts";
import { SoftAuthenticator } from "../_shared/passkeys/test-authenticator.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;
const ORIGIN = "https://swarm-team.app";
const PEOPLE = new Set([1001]);

const deps = (store = new MemoryStore(() => NOW)): HandlerDeps => ({
  store,
  now: () => NOW,
  secret: SECRET,
  userNameOf: (id) => Promise.resolve(PEOPLE.has(id) ? `u${id}` : null),
});

async function call(d: HandlerDeps, body: Record<string, unknown>, opts: { sig?: string; method?: string } = {}) {
  const raw = JSON.stringify({ ts: NOW, ...body });
  const sig = opts.sig ?? await hmacHex(SECRET, raw);
  const res = await handlePasskeyRequest(
    new Request("https://x/auth-passkey", {
      method: opts.method ?? "POST",
      headers: { "x-sig": sig },
      body: opts.method === "GET" ? undefined : raw,
    }),
    d,
  );
  return { status: res.status, body: await res.json() };
}

Deno.test("без подписи, с чужой подписью и с чужим секретом — 403", async () => {
  const d = deps();
  assertEquals((await call(d, { op: "start", telegram_id: 1001, origin: ORIGIN }, { sig: "" })).status, 403);
  assertEquals((await call(d, { op: "start", telegram_id: 1001, origin: ORIGIN }, { sig: "00" })).status, 403);
  const raw = JSON.stringify({ ts: NOW, op: "start", telegram_id: 1001, origin: ORIGIN });
  const res = await handlePasskeyRequest(
    new Request("https://x", { method: "POST", headers: { "x-sig": await hmacHex("other", raw) }, body: raw }),
    d,
  );
  assertEquals(res.status, 403);
});

Deno.test("подпись держит тело целиком: подмена telegram_id ломает её", async () => {
  const d = deps();
  const signed = JSON.stringify({ ts: NOW, op: "start", telegram_id: 1001, origin: ORIGIN });
  const tampered = JSON.stringify({ ts: NOW, op: "start", telegram_id: 1002, origin: ORIGIN });
  const res = await handlePasskeyRequest(
    new Request("https://x", { method: "POST", headers: { "x-sig": await hmacHex(SECRET, signed) }, body: tampered }),
    d,
  );
  assertEquals(res.status, 403);
});

Deno.test("запрос старше минуты (повтор) — 403", async () => {
  const d = deps();
  const raw = JSON.stringify({ ts: NOW - 61_000, op: "start", telegram_id: 1001, origin: ORIGIN });
  const res = await handlePasskeyRequest(
    new Request("https://x", { method: "POST", headers: { "x-sig": await hmacHex(SECRET, raw) }, body: raw }),
    d,
  );
  assertEquals(res.status, 403);
});

Deno.test("удалённый из allowed_users шаг не проходит ни на выдаче, ни на приёме", async () => {
  const d = deps();
  const a = await call(d, { op: "start", telegram_id: 7777, origin: ORIGIN, here: false });
  assertEquals([a.status, a.body.reason], [403, "unknown_user"]);
  const f = await call(d, { op: "finish", telegram_id: 7777, origin: ORIGIN, credential: {} });
  assertEquals([f.status, f.body.reason], [403, "unknown_user"]);
});

Deno.test("полный проход через HTTP: сохранение, затем подтверждение; осечка — 401 без подробностей", async () => {
  const d = deps();
  const device = await SoftAuthenticator.create();
  const s1 = await call(d, { op: "start", telegram_id: 1001, origin: ORIGIN, here: false });
  assertEquals([s1.status, s1.body.mode], [200, "create"]);
  const reg = await device.register({ challenge: s1.body.options.challenge, origin: ORIGIN, rpID: "swarm-team.app" });
  assertEquals(
    (await call(d, { op: "finish", telegram_id: 1001, origin: ORIGIN, name: "Chrome · Mac", credential: reg })).body,
    { ok: true, mode: "create" },
  );

  const s2 = await call(d, { op: "start", telegram_id: 1001, origin: ORIGIN, here: true });
  assertEquals(s2.body.mode, "get");
  const asr = await device.assert({ challenge: s2.body.options.challenge, origin: ORIGIN, rpID: "swarm-team.app" });
  assertEquals((await call(d, { op: "finish", telegram_id: 1001, origin: ORIGIN, credential: asr })).body, {
    ok: true,
    mode: "get",
  });
  const replay = await call(d, { op: "finish", telegram_id: 1001, origin: ORIGIN, credential: asr });
  assertEquals([replay.status, replay.body], [401, { ok: false, reason: "failed" }]);
});

Deno.test("чужой origin — 403, неизвестная операция — 400, GET — 405", async () => {
  const d = deps();
  assertEquals(
    (await call(d, { op: "start", telegram_id: 1001, origin: "https://evil.example", here: false })).status,
    403,
  );
  assertEquals((await call(d, { op: "boom", telegram_id: 1001, origin: ORIGIN })).status, 400);
  assertEquals((await call(d, { op: "start", telegram_id: "1001", origin: ORIGIN })).status, 400);
  assertEquals((await call(d, { op: "start" }, { method: "GET" })).status, 405);
});
