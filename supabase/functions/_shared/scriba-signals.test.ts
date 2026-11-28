import { assertEquals, assertRejects } from "@std/assert";
import {
  deliverSignals,
  makeSignalStore,
  SIGNAL_HEADER,
  signalAuthorized,
  type SignalRow,
  type SignalStore,
} from "./scriba-signals.ts";
import { parseWorkRequest } from "./scriba-work.ts";

const secret = "test-only-signal-credential-000000000000";
const row: SignalRow = {
  kind: "invite",
  work_id: "11111111-1111-4111-8111-111111111111",
  lease_id: "22222222-2222-4222-8222-222222222222",
  attempts: 1,
};

Deno.test("signal authorization rejects missing, wrong and unconfigured credentials", async () => {
  const request = (value?: string) =>
    new Request("http://internal/signal", { headers: value ? { [SIGNAL_HEADER]: value } : {} });
  assertEquals(await signalAuthorized(request(), secret), false);
  assertEquals(await signalAuthorized(request("wrong"), secret), false);
  assertEquals(await signalAuthorized(request(secret), ""), false);
  assertEquals(await signalAuthorized(request(secret), secret), true);
});

Deno.test("failed delivery persists retry, next invocation acknowledges the same durable id", async () => {
  const receipts: Array<{ ok: boolean; reason: string | null }> = [];
  const payloads: unknown[] = [];
  const store: SignalStore = {
    take: () => Promise.resolve([{ ...row, attempts: receipts.length + 1 }]),
    finish: (_row, ok, reason) => {
      receipts.push({ ok, reason });
      return Promise.resolve();
    },
  };
  let online = false;
  const send: typeof fetch = (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    assertEquals(new Headers(init?.headers).get(SIGNAL_HEADER), secret);
    return Promise.resolve(new Response(JSON.stringify({ ok: online }), { status: online ? 200 : 503 }));
  };
  const deps = { store, url: "http://scriba-signals:8091/signal", secret, fetch: send };
  assertEquals(await deliverSignals(deps), { acknowledged: 0, retrying: 1 });
  online = true;
  assertEquals(await deliverSignals(deps), { acknowledged: 1, retrying: 0 });
  assertEquals(receipts, [{ ok: false, reason: "http_503" }, { ok: true, reason: null }]);
  assertEquals(payloads, [{ kind: "invite", id: row.work_id }, { kind: "invite", id: row.work_id }]);
});

Deno.test("a 200 without an explicit bot receipt is not an acknowledgement", async () => {
  let acknowledged = false;
  const store: SignalStore = {
    take: () => Promise.resolve([row]),
    finish: (_row, ok) => {
      acknowledged = ok;
      return Promise.resolve();
    },
  };
  await deliverSignals({
    store,
    secret,
    url: "http://scriba-signals:8091/signal",
    fetch: () => Promise.resolve(new Response("ok")),
  });
  assertEquals(acknowledged, false);
});

Deno.test("misconfiguration does not lease work; receipt storage failure remains retryable", async () => {
  let leases = 0;
  const store: SignalStore = {
    take: () => {
      leases++;
      return Promise.resolve([row]);
    },
    finish: () => Promise.reject(new Error("database unavailable")),
  };
  await assertRejects(() => deliverSignals({ store, secret: "", url: "http://scriba-signals:8091/signal" }));
  assertEquals(leases, 0);
  await assertRejects(() => deliverSignals({ store, secret, url: "https://public.example/signal" }));
  assertEquals(leases, 0);
  await assertRejects(() =>
    deliverSignals({
      store,
      secret,
      url: "http://scriba-signals:8091/signal",
      fetch: () => Promise.resolve(Response.json({ ok: true })),
    })
  );
});

Deno.test("work request is targeted and started has an explicit boolean contract", () => {
  assertEquals(parseWorkRequest({ id: row.work_id }), { id: row.work_id, started: false });
  assertEquals(parseWorkRequest({ id: row.work_id, started: true }), { id: row.work_id, started: true });
  for (const body of [{}, { id: "invalid" }, { id: row.work_id, started: "true" }]) {
    let rejected = false;
    try {
      parseWorkRequest(body);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});

Deno.test("stale database lease receipt is not reported as an acknowledgement", async () => {
  const db = { rpc: () => Promise.resolve({ data: false, error: null }) } as unknown as Parameters<
    typeof makeSignalStore
  >[0];
  await assertRejects(() => makeSignalStore(db).finish(row, true, null), Error, "signal receipt was not stored");
});
