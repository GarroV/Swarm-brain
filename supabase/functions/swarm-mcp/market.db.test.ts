// Доступ инструментов рынка в MCP на настоящей базе: читает тот, кому страна открыта,
// пишет только админ; видны все страны (allowed_markets не режет), кроме выдуманной XD.
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { MARKET_TOOLS } from "./market.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CC = "QN";
const WS = "qa-market-mcp";
const MEMBER = 990_001, ADMIN = 990_002;

async function wipe() {
  const { data: cos } = await sb.from("mkt_companies").select("id").eq("country", CC);
  const ids = (cos ?? []).map((r) => r.id);
  if (ids.length) await sb.from("mkt_financials").delete().in("company_id", ids);
  for (const t of ["mkt_companies", "mkt_facts", "mkt_editorial", "mkt_sources"]) {
    await sb.from(t).delete().eq("country", CC);
  }
  await sb.from("mkt_runs").delete().eq("country", CC);
  await sb.from("mkt_chains").delete().eq("country", CC);
  await sb.from("allowed_users").delete().in("telegram_id", [MEMBER, ADMIN]);
  await sb.from("workspaces").delete().eq("id", WS);
}

async function seed() {
  await wipe();
  await sb.from("workspaces").insert({ id: WS, name: "QA market", allowed_markets: [CC] });
  await sb.from("allowed_users").insert([
    { telegram_id: MEMBER, group_id: WS, added_by: ADMIN, is_admin: false },
    { telegram_id: ADMIN, group_id: WS, added_by: ADMIN, is_admin: true },
  ]);
  await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC", slot: 1 });
}

const call = (tool: string, who: number, args: Record<string, unknown>) =>
  MARKET_TOOLS[tool]({ ...args, requesting_user_id: who });

const YEAR = { country: CC, company: "Q Co", year: 2024, revenue: 1000, currency: "EUR", source: "https://x" };

Deno.test("member reads an open country but cannot write; admin writes and the write is journaled", async () => {
  await seed();
  assert((await call("market_status", MEMBER, { country: CC })).includes(`${CC}: что заполнено`));
  const refused = await call("market_set_company_year", MEMBER, YEAR);
  assert(refused.includes("только админ"), refused);
  const { count: none } = await sb.from("mkt_companies").select("id", { count: "exact", head: true }).eq("country", CC);
  assertEquals(none, 0);

  const done = await call("market_set_company_year", ADMIN, YEAR);
  assert(done.startsWith("✅"), done);
  const money = await call("market_get", MEMBER, { country: CC, section: "money" });
  assert(money.includes("Q Co") && money.includes("1000"), money);
  const { data: runs } = await sb.from("mkt_runs").select("source, stats").eq("country", CC);
  assertEquals(runs?.map((r) => [r.source, (r.stats as { by: number }).by]), [["mcp", ADMIN]]);
  await wipe();
});

Deno.test("market_add_fact: admin only, readable through market_get facts", async () => {
  await seed();
  const FACT = { country: CC, topic: "timeline", date: "2025-03", text: "Выход на рынок", source: "https://x" };
  assert((await call("market_add_fact", MEMBER, FACT)).includes("только админ"));
  const done = await call("market_add_fact", ADMIN, FACT);
  assert(done.startsWith("✅"), done);
  const facts = await call("market_get", MEMBER, { country: CC, section: "facts", topic: "timeline" });
  assert(facts.includes("Выход на рынок"), facts);
  await wipe();
});

Deno.test("a country outside the workspace markets is open; the fictional XD is closed even to an admin", async () => {
  await seed();
  for (const tool of ["market_status", "market_get"]) {
    const r = await call(tool, MEMBER, { country: "QZ", section: "events" });
    assert(!r.includes("не открыта"), `${tool}: ${r}`);
  }
  for (const tool of ["market_status", "market_get", "market_set_block"]) {
    const r = await call(tool, ADMIN, { country: "XD", section: "events", block: "events", payload: [], source: "x" });
    assert(r.includes("не открыта"), `${tool}: ${r}`);
  }
  await wipe();
});

Deno.test("template is readable without a country", async () => {
  assert((await call("market_template", MEMBER, {})).includes("[money]"));
});
