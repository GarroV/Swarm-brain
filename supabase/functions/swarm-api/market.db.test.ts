// «Анализ рынка»: доступ к стране — по allowed_markets воркспейса, XD — только демо;
// импорт снимка — только админ, битый снимок отклоняется с причинами. Настоящая база.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const { handleMarketRoutes } = await import("./market.ts");

const WS = "t_market";
const ORIGIN = "http://x";

async function setup() {
  await sb.from("workspaces").upsert({ id: WS, name: "t market", allowed_markets: ["QB"] });
  for (const cc of ["QB", "QC", "XD"]) {
    await sb.from("mkt_chains").upsert({ country: cc, key: "a", name: "A" }, { onConflict: "country,key" });
  }
}
async function teardown() {
  await sb.from("mkt_chains").delete().in("country", ["QB", "QC"]).eq("key", "a");
  await sb.from("workspaces").delete().eq("id", WS);
}

const call = (path: string, opts: { demo?: boolean; admin?: boolean; method?: string; body?: string } = {}) =>
  handleMarketRoutes(
    new Request(ORIGIN + path, { method: opts.method ?? "GET", body: opts.body }),
    path,
    1,
    opts.demo ? "demo" : WS,
    opts.admin ?? false,
    opts.demo ?? false,
    ORIGIN,
  );

Deno.test("market access follows allowed_markets; XD only for demo", async () => {
  await setup();
  assertEquals((await call("/market/QB"))!.status, 200);
  assertEquals((await call("/market/qb"))!.status, 200);
  assertEquals((await call("/market/QC"))!.status, 403);
  assertEquals((await call("/market/XD"))!.status, 403);
  assertEquals((await call("/market/XD", { demo: true }))!.status, 200);
  assertEquals((await call("/market/QB", { demo: true }))!.status, 403);
  assertEquals(await (await call("/market/countries"))!.json(), ["QB"]);
  assertEquals(await (await call("/market/countries", { demo: true }))!.json(), ["XD"]);
  await teardown();
});

Deno.test("import is admin-only and rejects a broken snapshot with reasons", async () => {
  await setup();
  const body = JSON.stringify({ locs: [] });
  assertEquals((await call("/market/QB/import", { method: "POST", body }))!.status, 403);
  const res = await call("/market/QB/import", { method: "POST", body, admin: true });
  assertEquals(res!.status, 400);
  assertEquals((await res!.json()).details, ["chains: обязателен непустой массив"]);
  const notJson = await call("/market/QB/import", { method: "POST", body: "{oops", admin: true });
  assertEquals(notJson!.status, 400);
  await teardown();
});

Deno.test("candidates are admin-only; unknown candidate is 404", async () => {
  await setup();
  assertEquals((await call("/market/QB/candidates"))!.status, 403);
  assertEquals((await call("/market/QB/candidates", { admin: true }))!.status, 200);
  const missing = "00000000-0000-4000-8000-000000000000";
  assertEquals((await call(`/market/candidates/${missing}/accept`, { method: "POST", admin: true }))!.status, 404);
  assertEquals((await call(`/market/candidates/${missing}/accept`, { method: "POST" }))!.status, 403);
  await teardown();
});

Deno.test("accept-all is admin-only and reports how many finds became points", async () => {
  await setup();
  assertEquals((await call("/market/QB/candidates/accept-all", { method: "POST" }))!.status, 403);
  const res = await call("/market/QB/candidates/accept-all", { method: "POST", admin: true });
  assertEquals(res!.status, 200);
  assertEquals(await res!.json(), { accepted: 0 });
  await teardown();
});

Deno.test("routes outside /market are not handled", async () => {
  assertEquals(await call("/tasks"), null);
  assertEquals(await call("/marketing"), null);
});
