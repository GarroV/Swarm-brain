// Тест решающего правила service worker: приватный API идёт МИМО кэша, статика — cache-first.
//
// Зачем отдельный раннер: в miniapp его нет вовсе (только next build / tsc), а правило
// критично — при промахе приватные записи оседают в Cache Storage устройства и экран
// показывает вчерашние данные (issue #71). Гоняем на Deno, тем же, чем проверяются
// edge-функции:  deno test --allow-read miniapp/sw.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ORIGIN = "https://swarm-brain.pages.dev";

interface FakeRequest { url: string; method: string; mode: string; destination: string }

// Выполняет РЕАЛЬНЫЙ public/sw.js в песочнице с моками и отвечает: перехватил ли SW запрос
// (respondWith) — то есть попал ли он в кэш-логику вместо прямого выхода в сеть.
async function swIntercepts(
  url: string,
  init: Partial<Omit<FakeRequest, "url">> = {},
): Promise<boolean> {
  const code = await Deno.readTextFile(new URL("./public/sw.js", import.meta.url));
  const listeners: Record<string, (e: unknown) => void> = {};
  const selfMock = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    location: { origin: ORIGIN },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const cacheMock = {
    addAll: () => Promise.resolve(),
    put: () => Promise.resolve(),
    match: () => Promise.resolve(undefined),
  };
  const cachesMock = {
    open: () => Promise.resolve(cacheMock),
    keys: () => Promise.resolve([] as string[]),
    match: () => Promise.resolve(undefined),
    delete: () => Promise.resolve(true),
  };
  new Function("self", "caches", "fetch", code)(
    selfMock,
    cachesMock,
    () => Promise.resolve(new Response("")),
  );

  let intercepted = false;
  listeners.fetch?.({
    request: {
      url,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
      destination: init.destination ?? "",
    } as FakeRequest,
    respondWith: (p: Promise<Response>) => { intercepted = true; void p?.catch?.(() => {}); },
    waitUntil: () => {},
  });
  return intercepted;
}

Deno.test("приватный API через same-origin прокси /api/* НЕ кэшируется", async () => {
  assertEquals(await swIntercepts(`${ORIGIN}/api/agent-meetings/9c1f`), false);
  assertEquals(await swIntercepts(`${ORIGIN}/api/entries?limit=50`), false);
  assertEquals(await swIntercepts(`${ORIGIN}/api/tasks`), false);
});

Deno.test("прямые вызовы supabase-функций НЕ кэшируются (регресс)", async () => {
  assertEquals(await swIntercepts("https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-api/entries"), false);
});

Deno.test("хэшированная статика кэшируется", async () => {
  assertEquals(await swIntercepts(`${ORIGIN}/_next/static/chunks/main-abc123.js`, { destination: "script" }), true);
});

Deno.test("навигация обслуживается SW (network-first + офлайн-фолбэк)", async () => {
  assertEquals(await swIntercepts(`${ORIGIN}/roy`, { mode: "navigate", destination: "document" }), true);
});

Deno.test("мутации API не трогаем в принципе", async () => {
  assertEquals(await swIntercepts(`${ORIGIN}/api/entries`, { method: "POST" }), false);
});
