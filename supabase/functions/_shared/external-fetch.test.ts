import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { externalFetch, ExternalFetchError, redactUrl } from "./external-fetch.ts";

const noSleep = () => Promise.resolve();

/** fetch, который отвечает по очереди заданными ответами и считает вызовы. */
function scripted(responses: Array<() => Response | Promise<Response>>) {
  let calls = 0;
  const fetchFn = ((_input: unknown, _init?: RequestInit) => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return Promise.resolve(next());
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

/** fetch, который не отвечает никогда — только реагирует на отмену сигналом. */
const hangingFetch = ((_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

Deno.test("externalFetch: повисший сервис обрывается по сроку — ExternalFetchError(timeout)", async () => {
  const started = Date.now();
  const err = await assertRejects(
    () =>
      externalFetch("https://api.example.com/x", { method: "POST" }, {
        service: "svc",
        timeoutMs: 50,
        fetchFn: hangingFetch,
      }),
    ExternalFetchError,
  );
  assertEquals(err.reason, "timeout");
  assert(Date.now() - started < 2_000, "срок не сработал");
});

Deno.test("externalFetch: истёкший срок не повторяется даже у GET", async () => {
  let calls = 0;
  const fetchFn = ((input: unknown, init?: RequestInit) => {
    calls++;
    return hangingFetch(input as string, init);
  }) as typeof fetch;
  await assertRejects(
    () => externalFetch("https://api.example.com/x", {}, { service: "svc", timeoutMs: 30, fetchFn, sleepFn: noSleep }),
    ExternalFetchError,
  );
  assertEquals(calls, 1);
});

Deno.test("externalFetch: отмена извне пробрасывает причину вызывающего, не нашу ошибку", async () => {
  const ctl = new AbortController();
  const reason = new Error("lease lost");
  setTimeout(() => ctl.abort(reason), 10);
  const err = await assertRejects(() =>
    externalFetch("https://api.example.com/x", {}, {
      service: "svc",
      timeoutMs: 5_000,
      signal: ctl.signal,
      fetchFn: hangingFetch,
    })
  );
  assertEquals(err, reason);
});

Deno.test("externalFetch: не-2xx возвращается вызывающему с телом (статус проверяет и логирует)", async () => {
  const { fetchFn } = scripted([() => new Response('{"ok":false}', { status: 400 })]);
  const res = await externalFetch("https://api.example.com/x", { method: "POST" }, {
    service: "svc",
    timeoutMs: 1_000,
    fetchFn,
  });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { ok: false });
});

Deno.test("externalFetch: POST без явного attempts НЕ повторяется ни на 5xx, ни на обрыве сети", async () => {
  const s5xx = scripted([() => new Response("", { status: 503 }), () => new Response("ok")]);
  const res = await externalFetch("https://api.example.com/x", { method: "POST" }, {
    service: "svc",
    timeoutMs: 1_000,
    fetchFn: s5xx.fetchFn,
    sleepFn: noSleep,
  });
  assertEquals(res.status, 503);
  assertEquals(s5xx.calls(), 1);

  const net = scripted([() => Promise.reject(new TypeError("connection reset")), () => new Response("ok")]);
  const err = await assertRejects(
    () =>
      externalFetch("https://api.example.com/x", { method: "POST" }, {
        service: "svc",
        timeoutMs: 1_000,
        fetchFn: net.fetchFn,
        sleepFn: noSleep,
      }),
    ExternalFetchError,
  );
  assertEquals(err.reason, "network");
  assertEquals(net.calls(), 1);
});

Deno.test("externalFetch: GET повторяется на 5xx и обрыве сети, но не на 4xx", async () => {
  const flaky = scripted([
    () => new Response("", { status: 502 }),
    () => Promise.reject(new TypeError("reset")),
    () => new Response("ok"),
  ]);
  const res = await externalFetch("https://api.example.com/x", {}, {
    service: "svc",
    timeoutMs: 1_000,
    fetchFn: flaky.fetchFn,
    sleepFn: noSleep,
  });
  assertEquals(await res.text(), "ok");
  assertEquals(flaky.calls(), 3);

  const client = scripted([() => new Response("", { status: 404 }), () => new Response("ok")]);
  const r404 = await externalFetch("https://api.example.com/x", {}, {
    service: "svc",
    timeoutMs: 1_000,
    fetchFn: client.fetchFn,
    sleepFn: noSleep,
  });
  assertEquals(r404.status, 404);
  assertEquals(client.calls(), 1);
});

Deno.test("externalFetch: явный attempts у POST повторяет 429 с паузой из retry-after", async () => {
  const delays: number[] = [];
  const s = scripted([
    () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
    () => new Response("ok"),
  ]);
  const res = await externalFetch("https://api.example.com/x", { method: "POST" }, {
    service: "svc",
    timeoutMs: 1_000,
    attempts: 4,
    fetchFn: s.fetchFn,
    sleepFn: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  assertEquals(res.status, 200);
  assertEquals(s.calls(), 2);
  assertEquals(delays, [2_000]);
});

Deno.test("redactUrl: токен бота и query в лог не попадают", () => {
  assertEquals(
    redactUrl("https://api.telegram.org/bot123:SECRET/sendMessage?chat_id=1"),
    "https://api.telegram.org/bot***/sendMessage",
  );
  assertEquals(
    redactUrl("https://api.telegram.org/file/bot123:SECRET/photos/a.jpg"),
    "https://api.telegram.org/file/bot***/photos/a.jpg",
  );
  assertEquals(
    redactUrl("https://www.googleapis.com/drive/v3/files?q=secret"),
    "https://www.googleapis.com/drive/v3/files",
  );
});

Deno.test("externalFetch: в лог сбоя не попадает токен из URL", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => logged.push(args.join(" "));
  try {
    const { fetchFn } = scripted([() => new Response("", { status: 401 })]);
    await externalFetch("https://api.telegram.org/bot123:SECRET/sendMessage", { method: "POST" }, {
      service: "telegram",
      timeoutMs: 1_000,
      fetchFn,
    });
  } finally {
    console.error = orig;
  }
  assertEquals(logged.length, 1);
  assert(!logged[0].includes("SECRET"), logged[0]);
  assert(logged[0].includes("HTTP 401"), logged[0]);
});
