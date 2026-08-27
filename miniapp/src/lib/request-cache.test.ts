// Раннер тот же, что у sw.test.ts и edge-функций:  deno test miniapp/src/lib/request-cache.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRequestCache } from "./request-cache.ts";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

Deno.test("одновременные одинаковые GET-ы делят один запрос", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  let calls = 0;
  const d = deferred<string>();
  const fetcher = () => { calls++; return d.promise; };

  const a = cache.run("/meetings", fetcher);
  const b = cache.run("/meetings", fetcher);
  const e = cache.run("/meetings", fetcher);
  d.resolve("payload");
  assertEquals(await a, "payload");
  assertEquals(await b, "payload");
  assertEquals(await e, "payload");
  assertEquals(calls, 1);
});

Deno.test("разные ключи не смешиваются", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  const seen: string[] = [];
  const f = (k: string) => () => { seen.push(k); return Promise.resolve(k); };
  assertEquals(await cache.run("/tasks", f("/tasks")), "/tasks");
  assertEquals(await cache.run("/projects", f("/projects")), "/projects");
  assertEquals(seen, ["/tasks", "/projects"]);
});

Deno.test("повтор внутри TTL берётся из кэша, после TTL — новый запрос", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve(calls); };

  assertEquals(await cache.run("/notifications", fetcher), 1);
  c.advance(2499);
  assertEquals(await cache.run("/notifications", fetcher), 1);
  assertEquals(calls, 1);
  c.advance(2);                                   // TTL истёк
  assertEquals(await cache.run("/notifications", fetcher), 2);
  assertEquals(calls, 2);
});

Deno.test("TTL не должен глушить поллинг: 10-секундный интервал всегда идёт в сеть", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve(calls); };
  for (let i = 0; i < 3; i++) { await cache.run("/agent-meetings", fetcher); c.advance(10_000); }
  assertEquals(calls, 3);
});

Deno.test("ошибка НЕ кэшируется — следующий вызов пробует снова", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  let calls = 0;
  const fetcher = () => { calls++; return calls === 1 ? Promise.reject(new Error("сеть")) : Promise.resolve("ок"); };
  await assertRejects(() => cache.run("/me", fetcher));
  assertEquals(await cache.run("/me", fetcher), "ок");
  assertEquals(calls, 2);
});

Deno.test("invalidate сбрасывает кэш — после мутации данные перечитываются", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve(calls); };
  assertEquals(await cache.run("/tasks", fetcher), 1);
  cache.invalidate();
  assertEquals(await cache.run("/tasks", fetcher), 2);
  assertEquals(calls, 2);
});

Deno.test("invalidate во время полёта: следующий вызов делает свежий запрос, ждущие получают свой ответ", async () => {
  const c = clock(); const cache = createRequestCache({ ttlMs: 2500, now: c.now });
  let calls = 0;
  const d1 = deferred<string>(), d2 = deferred<string>();
  const fetcher = () => { calls++; return calls === 1 ? d1.promise : d2.promise; };

  const first = cache.run("/tasks", fetcher);
  cache.invalidate();
  const second = cache.run("/tasks", fetcher);
  d1.resolve("старое"); d2.resolve("новое");
  assertEquals(await first, "старое");
  assertEquals(await second, "новое");
  assertEquals(calls, 2);
});
