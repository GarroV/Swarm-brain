// Переключатель автозапуска бота по календарю (D021): человек включает и выключает его только себе.
//
// Хранилище — двойник: записывает, чей флаг читали и меняли. Личность берётся из авторизации веба
// (ctx.telegramId), тело запроса её не задаёт — «включить коллеге» здесь красное.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AutojoinContext, type AutojoinStore, handleAutojoinRoutes } from "./autojoin.ts";

function fakeStore(initial: Record<number, boolean>) {
  const flags = { ...initial };
  const writes: Array<[number, boolean]> = [];
  const reads: number[] = [];
  const store: AutojoinStore = {
    read: (id) => {
      reads.push(id);
      return Promise.resolve(id in flags ? flags[id] : null);
    },
    write: (id, enabled) => {
      writes.push([id, enabled]);
      if (!(id in flags)) return Promise.resolve(false);
      flags[id] = enabled;
      return Promise.resolve(true);
    },
  };
  return { store, flags, writes, reads };
}

function ctx(store: AutojoinStore, over: Partial<AutojoinContext> = {}): AutojoinContext {
  return { store, telegramId: 1, isDemo: false, origin: "http://localhost", ...over };
}

function put(body: unknown): Request {
  return new Request("http://localhost/scriba/autojoin", { method: "PUT", body: JSON.stringify(body) });
}

const GET = () => new Request("http://localhost/scriba/autojoin");

Deno.test("по умолчанию выключено: GET отдаёт свой флаг", async () => {
  const { store, reads } = fakeStore({ 1: false, 2: true });
  const res = await handleAutojoinRoutes(ctx(store), GET(), "/scriba/autojoin");
  assertEquals(res?.status, 200);
  assertEquals(await res!.json(), { enabled: false });
  assertEquals(reads, [1]);
});

Deno.test("включение и выключение меняют флаг самого человека", async () => {
  const { store, flags } = fakeStore({ 1: false });
  const on = await handleAutojoinRoutes(ctx(store), put({ enabled: true }), "/scriba/autojoin");
  assertEquals([on?.status, await on!.json()], [200, { enabled: true }]);
  assertEquals(flags[1], true);
  const off = await handleAutojoinRoutes(ctx(store), put({ enabled: false }), "/scriba/autojoin");
  assertEquals([off?.status, await off!.json()], [200, { enabled: false }]);
  assertEquals(flags[1], false);
});

Deno.test("ПРАВА: чужой id в теле игнорируется — меняется только свой флаг", async () => {
  const { store, flags, writes } = fakeStore({ 1: false, 2: false });
  const res = await handleAutojoinRoutes(
    ctx(store),
    put({ enabled: true, telegram_id: 2, invited_by: 2 }),
    "/scriba/autojoin",
  );
  assertEquals(res?.status, 200);
  assertEquals(writes, [[1, true]]);
  assertEquals(flags[2], false);
});

Deno.test("ПРАВА: демо не включает бота никому — 403 на EN и RU, база не тронута", async () => {
  const { store, writes, reads } = fakeStore({ 1: false });
  for (const req of [put({ enabled: true }), GET()]) {
    const res = await handleAutojoinRoutes(ctx(store, { isDemo: true }), req, "/scriba/autojoin");
    assertEquals(res?.status, 403);
    const body = await res!.json();
    assertEquals(body.code, "demo_not_allowed");
    assertEquals(typeof body.error, "string");
    assertEquals(typeof body.error_ru, "string");
  }
  assertEquals([writes, reads], [[], []]);
});

Deno.test("тело без булева enabled — 400, флаг не меняется", async () => {
  const { store, writes } = fakeStore({ 1: false });
  for (const body of [{}, { enabled: "true" }, { enabled: 1 }, null]) {
    const res = await handleAutojoinRoutes(ctx(store), put(body), "/scriba/autojoin");
    assertEquals(res?.status, 400);
    assertEquals((await res!.json()).code, "invalid_body");
  }
  const broken = new Request("http://localhost/scriba/autojoin", { method: "PUT", body: "{" });
  assertEquals((await handleAutojoinRoutes(ctx(store), broken, "/scriba/autojoin"))?.status, 400);
  assertEquals(writes, []);
});

Deno.test("строки человека нет — 404, а не молчаливый успех", async () => {
  const { store } = fakeStore({});
  const res = await handleAutojoinRoutes(ctx(store), put({ enabled: true }), "/scriba/autojoin");
  assertEquals(res?.status, 404);
});

Deno.test("чужие пути и методы — не наш маршрут", async () => {
  const { store } = fakeStore({ 1: false });
  assertEquals(await handleAutojoinRoutes(ctx(store), GET(), "/scriba/other"), null);
  const del = new Request("http://localhost/scriba/autojoin", { method: "DELETE" });
  assertEquals((await handleAutojoinRoutes(ctx(store), del, "/scriba/autojoin"))?.status, 405);
});
