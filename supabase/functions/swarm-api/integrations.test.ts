// Подключение интеграций (календарь Google, ключ Granola) — право доступа: демо-сессия общая
// для всех посетителей, и привязка, сделанная одним, видна следующим (issue #573). Сервер
// отказывает демо в подключении, а не полагается на то, что веб спрячет кнопку.
//
// Хранилище — двойник: записывает, что пытались сохранить и какой ключ проверяли снаружи.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleIntegrationConnectRoutes, type IntegrationsContext } from "./integrations.ts";

function fakeCtx(over: Partial<IntegrationsContext> = {}) {
  const saved: Array<[number, string]> = [];
  const validated: string[] = [];
  const ctx: IntegrationsContext = {
    telegramId: 1,
    isDemo: false,
    origin: "http://localhost",
    validateGranolaKey: (key) => {
      validated.push(key);
      return Promise.resolve(key === "good-key");
    },
    saveGranolaKey: (id, key) => {
      saved.push([id, key]);
      return Promise.resolve();
    },
    ...over,
  };
  return { ctx, saved, validated };
}

const granola = (body: unknown) =>
  new Request("http://localhost/integrations/granola", { method: "POST", body: JSON.stringify(body) });
const connectUrl = () => new Request("http://localhost/google/connect-url");

Deno.test("обычный человек: ключ Granola проверяется и сохраняется за ним самим", async () => {
  const { ctx, saved, validated } = fakeCtx();
  const res = await handleIntegrationConnectRoutes(ctx, granola({ api_key: "good-key" }), "/integrations/granola");
  assertEquals(res?.status, 204);
  assertEquals([validated, saved], [["good-key"], [[1, "good-key"]]]);
});

Deno.test("неверный ключ Granola — 400, ничего не сохранено", async () => {
  const { ctx, saved } = fakeCtx();
  const res = await handleIntegrationConnectRoutes(ctx, granola({ api_key: "bad" }), "/integrations/granola");
  assertEquals(res?.status, 400);
  assertEquals((await res!.json()).code, "invalid_key");
  assertEquals(saved, []);
});

Deno.test("обычный человек получает адрес подключения календаря", async () => {
  const { ctx } = fakeCtx();
  const res = await handleIntegrationConnectRoutes(ctx, connectUrl(), "/google/connect-url");
  assertEquals(res?.status, 200);
  assertEquals(await res!.json(), { url: "/api/auth/google/start?flow=calendar" });
});

Deno.test("ПРАВА: демо не подключает Granola — 403 на EN и RU, ключ не проверялся и не сохранён", async () => {
  const { ctx, saved, validated } = fakeCtx({ isDemo: true });
  const res = await handleIntegrationConnectRoutes(ctx, granola({ api_key: "good-key" }), "/integrations/granola");
  assertEquals(res?.status, 403);
  const body = await res!.json();
  assertEquals(body.code, "demo_not_allowed");
  assertEquals(typeof body.error, "string");
  assertEquals(typeof body.error_ru, "string");
  assertEquals([validated, saved], [[], []]);
});

Deno.test("ПРАВА: демо не получает адрес подключения календаря — 403", async () => {
  const { ctx } = fakeCtx({ isDemo: true });
  const res = await handleIntegrationConnectRoutes(ctx, connectUrl(), "/google/connect-url");
  assertEquals(res?.status, 403);
  assertEquals((await res!.json()).code, "demo_not_allowed");
});

Deno.test("чужие маршруты не перехватываются", async () => {
  const { ctx } = fakeCtx({ isDemo: true });
  const del = new Request("http://localhost/integrations/granola", { method: "DELETE" });
  assertEquals(await handleIntegrationConnectRoutes(ctx, del, "/integrations/granola"), null);
  assertEquals(await handleIntegrationConnectRoutes(ctx, connectUrl(), "/integrations"), null);
});
