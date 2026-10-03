// Ручной ввод рынка (MCP) на настоящей базе: пересчёт валюты, «было/стало», отказы без
// источника и с прибылью, правка точки делает её ручной, новая сеть встаёт в конец палитры.
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { setBlock, setCompanyYear, setPrice, upsertChain, upsertLocation } from "./manual.ts";
import { countryStatus } from "./template.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CC = "QM"; // своя тестовая страна, чтобы не пересекаться с db.db.test.ts (QA)
const SRC = "https://example.org/report.pdf";

async function wipe() {
  const { data: cos } = await sb.from("mkt_companies").select("id").eq("country", CC);
  const ids = (cos ?? []).map((r) => r.id);
  if (ids.length) await sb.from("mkt_financials").delete().in("company_id", ids);
  for (const t of ["mkt_locations", "mkt_companies", "mkt_prices", "mkt_editorial", "mkt_sources"]) {
    await sb.from(t).delete().eq("country", CC);
  }
  await sb.from("mkt_chains").delete().eq("country", CC);
}

async function seedChain() {
  await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC", slot: 3 });
}

Deno.test("company year: leva are converted at the fixed rate, the second write shows what it replaced", async () => {
  await wipe();
  await seedChain();
  const first = await setCompanyYear(sb, CC, {
    chain: "kfc",
    company: "АмРест ЕООД",
    reg_id: "175297584",
    year: 2022,
    revenue: 24_972_000,
    currency: "BGN",
    source: SRC,
  });
  assert(first.ok, JSON.stringify(first));
  assertEquals(first.before, null);
  assertEquals(first.after.revenue_eur, Math.round(24_972_000 / 1.95583));

  const second = await setCompanyYear(sb, CC, {
    company: "АмРест ЕООД",
    year: 2022,
    revenue: 12_800_000,
    currency: "EUR",
    employees: 400,
    source: SRC,
  });
  assert(second.ok);
  assertEquals(second.before?.revenue_eur, Math.round(24_972_000 / 1.95583));
  assertEquals(second.after.revenue_eur, 12_800_000);

  const { data: co } = await sb.from("mkt_companies").select("id").eq("country", CC).single();
  const { data: fin } = await sb.from("mkt_financials").select("verification, employees").eq("company_id", co!.id)
    .single();
  assertEquals(fin, { verification: "confirmed", employees: 400 });
  const { data: src } = await sb.from("mkt_sources").select("adapter, feeds, mode, last_ok_at").eq("country", CC);
  assertEquals(src?.map((s) => [s.adapter, s.feeds, s.mode]), [["manual", "financials", "manual"]]);
  assert(src?.[0].last_ok_at);
});

Deno.test("company year: no source, floating currency and unknown chain are refused without writing", async () => {
  await wipe();
  await seedChain();
  const base = { company: "X", year: 2024, revenue: 1, currency: "EUR", source: SRC };
  const noSource = await setCompanyYear(sb, CC, { ...base, source: " " });
  const usd = await setCompanyYear(sb, CC, { ...base, currency: "USD" });
  const chain = await setCompanyYear(sb, CC, { ...base, chain: "nope" });
  for (const r of [noSource, usd, chain]) assert(!r.ok);
  assert(!noSource.ok && noSource.error.includes("source"));
  assert(!usd.ok && usd.error.includes("currency"));
  const { count } = await sb.from("mkt_companies").select("id", { count: "exact", head: true }).eq("country", CC);
  assertEquals(count, 0);
});

Deno.test("location: a new point is manual; a corrected machine point stops being the collector's", async () => {
  await wipe();
  await seedChain();
  const added = await upsertLocation(sb, CC, {
    chain: "kfc",
    name: "KFC Mall",
    city: "Sofia",
    address: "Bul. 1",
    lat: 42.7,
    lng: 23.3,
    opened: "2024-05",
    source: SRC,
  });
  assert(added.ok, JSON.stringify(added));
  assertEquals([added.after.verification, added.after.status], ["added", "open"]);

  const { data: osm } = await sb.from("mkt_locations").insert({
    country: CC,
    chain_key: "kfc",
    ext_key: "osm-x",
    name: "KFC",
    lat: 42.6,
    lng: 23.2,
    status: "open",
    source_kind: "osm",
    verification: "unverified",
  }).select("id").single();
  const closed = await upsertLocation(sb, CC, { id: osm!.id, chain: "kfc", closed: "2025-01", source: SRC });
  assert(closed.ok, JSON.stringify(closed));
  const { data: row } = await sb.from("mkt_locations").select("status, closed, source_kind, verification").eq(
    "id",
    osm!.id,
  )
    .single();
  assertEquals(row, { status: "closed", closed: "2025-01", source_kind: "manual", verification: "corrected" });

  const noCoords = await upsertLocation(sb, CC, { chain: "kfc", name: "Y", source: SRC });
  assert(!noCoords.ok && noCoords.error.includes("lat"));
  const badDate = await upsertLocation(sb, CC, { id: osm!.id, chain: "kfc", opened: "май 2020", source: SRC });
  assert(!badDate.ok);
});

Deno.test("block: replaced whole with the old content returned; wrong shape and profit refused", async () => {
  await wipe();
  const one = await setBlock(sb, CC, "events", [{ date: "2024-03", kind: "entry", chain: "kfc", text: "a" }], SRC);
  assert(one.ok);
  const two = await setBlock(sb, CC, "events", [{ date: "2025-01", kind: "open", chain: "kfc", text: "b" }], SRC);
  assert(two.ok);
  assertEquals((two.before as Array<{ text: string }>)[0].text, "a");
  const { data } = await sb.from("mkt_editorial").select("payload").eq("country", CC).eq("block", "events").single();
  assertEquals((data!.payload as Array<{ text: string }>).map((e) => e.text), ["b"]);

  const shape = await setBlock(sb, CC, "events", { text: "not a list" }, SRC);
  const profit = await setBlock(sb, CC, "summary", [{ title: "x", net_profit: 5 }], SRC);
  const unknown = await setBlock(sb, CC, "nonsense", [], SRC);
  assert(!shape.ok && !profit.ok && !unknown.ok);
  assert(!profit.ok && profit.error.includes("прибыль"));
});

Deno.test("chain: a new chain takes the next palette slot, an existing one keeps its slot", async () => {
  await wipe();
  await seedChain();
  const fresh = await upsertChain(sb, CC, { key: "popeyes", name: "Popeyes" });
  const renamed = await upsertChain(sb, CC, { key: "kfc", name: "KFC Bulgaria", kind: "other" });
  assert(fresh.ok && renamed.ok);
  const { data } = await sb.from("mkt_chains").select("key, name, slot").eq("country", CC).order("slot");
  assertEquals(data, [{ key: "kfc", name: "KFC Bulgaria", slot: 3 }, { key: "popeyes", name: "Popeyes", slot: 4 }]);
  const badKey = await upsertChain(sb, CC, { key: "Pizza Hut", name: "Pizza Hut" });
  assert(!badKey.ok);
});

Deno.test("price: converted to euro, same day overwrites, status counts it", async () => {
  await wipe();
  await seedChain();
  const a = await setPrice(sb, CC, {
    chain: "kfc",
    item: "Bucket",
    price: 19.56,
    currency: "BGN",
    seen_on: "2026-10-01",
    source: SRC,
  });
  assert(a.ok, JSON.stringify(a));
  assertEquals(a.after.price_eur, 10);
  const b = await setPrice(sb, CC, {
    chain: "kfc",
    item: "Bucket",
    price: 11,
    currency: "EUR",
    seen_on: "2026-10-01",
    source: SRC,
  });
  assert(b.ok);
  assertEquals(b.before?.price_eur, 10);
  const status = await countryStatus(sb, CC);
  assert(status.includes("Цены: 1"), status);
  await wipe();
});
