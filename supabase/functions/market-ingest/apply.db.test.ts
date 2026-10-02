// Правила приёма данных сборщиков — на настоящей базе (спека §«Правила сборщиков»).
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { applyIngest } from "./apply.ts";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CC = "QD";
const started_at = new Date().toISOString();

async function reset() {
  const { data: cos } = await sb.from("mkt_companies").select("id").eq("country", CC);
  const ids = (cos ?? []).map((r) => r.id);
  if (ids.length) await sb.from("mkt_financials").delete().in("company_id", ids);
  for (const t of ["mkt_candidates", "mkt_runs", "mkt_locations", "mkt_dodo_monthly", "mkt_companies", "mkt_sources"]) {
    await sb.from(t).delete().eq("country", CC);
  }
  await sb.from("mkt_chains").delete().eq("country", CC);
  const ch = await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC" });
  if (ch.error) throw new Error(`reset chains: ${ch.error.message}`);
  const ins = await sb.from("mkt_locations").insert([
    {
      country: CC,
      chain_key: "kfc",
      ext_key: "trusted",
      name: "T",
      lat: 45.8,
      lng: 15.9,
      status: "open",
      verification: "official",
      source_kind: "snapshot",
      missing_weeks: 0,
    },
    {
      country: CC,
      chain_key: "kfc",
      ext_key: "osm1",
      name: "O",
      lat: 45.9,
      lng: 16.0,
      status: "open",
      verification: "unverified",
      source_kind: "osm",
      missing_weeks: 2,
    },
  ]);
  if (ins.error) throw new Error(`reset locations: ${ins.error.message}`);
}

Deno.test("failed run changes nothing but is logged", async () => {
  await reset();
  await applyIngest(sb, { source: "osm", country: CC, started_at, failed: "504" }, "2026-10-05");
  const { data: locs } = await sb.from("mkt_locations").select("ext_key, missing_weeks").eq("country", CC).order(
    "ext_key",
  );
  assertEquals(locs!.map((l) => l.missing_weeks), [2, 0]);
  const { data: runs } = await sb.from("mkt_runs").select("status, error").eq("country", CC);
  assertEquals(runs, [{ status: "failed", error: "504" }]);
  const { count } = await sb.from("mkt_candidates").select("id", { count: "exact", head: true }).eq("country", CC);
  assertEquals(count, 0);
});

Deno.test("osm: new point → one candidate, trusted untouched, osm point flagged after 3 weeks", async () => {
  await reset();
  const p = {
    source: "osm" as const,
    country: CC,
    started_at,
    points: [{ chain: "kfc", name: "N", lat: 46.5, lng: 16.5, city: null, address: null, osm_id: "node/1" }],
  };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-12");
  const { data: c } = await sb.from("mkt_candidates").select("kind").eq("country", CC).order("kind");
  assertEquals(c!.map((x) => x.kind), ["maybe_closed", "new_location"]);
  const { data: t } = await sb.from("mkt_locations").select("status, missing_weeks").eq("ext_key", "trusted").single();
  assertEquals(t, { status: "open", missing_weeks: 0 });
});

Deno.test("dodo: re-sending the same days does not double the month; units upserted as internal", async () => {
  await reset();
  const p = {
    source: "dodo" as const,
    country: CC,
    started_at,
    revenue: null,
    units: [{
      name: "Zagreb-1",
      city: "Zagreb",
      address: "Ilica 1",
      lat: 45.81,
      lng: 15.97,
      opened: "2024-04-01",
      open: true,
      organization: "X d.o.o.",
    }],
    days: [{ date: "2026-09-29", counts: { aggregator: 4 } }],
  };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-05");
  const { data } = await sb.from("mkt_dodo_monthly").select("orders, complete").eq("country", CC).eq("month", "2026-09")
    .single();
  assertEquals((data!.orders as Record<string, number>).aggregator, 4);
  assertEquals(data!.complete, true);
  const { data: u } = await sb.from("mkt_locations").select("verification, source_kind").eq("country", CC).eq(
    "chain_key",
    "dodo",
  );
  assertEquals(u, [{ verification: "internal", source_kind: "dodo" }]);
});

Deno.test("registry: new year written, change over trusted value becomes a candidate", async () => {
  await reset();
  const { data: co } = await sb.from("mkt_companies").insert({
    country: CC,
    chain_key: "kfc",
    name: "KFC Co",
    reg_id: "R1",
  })
    .select("id").single();
  await sb.from("mkt_financials").insert({
    company_id: co!.id,
    year: 2024,
    revenue_eur: 100,
    verification: "confirmed",
  });
  await applyIngest(sb, {
    source: "registry",
    adapter: "ee-ariregister",
    country: CC,
    started_at,
    years: [
      { reg_id: "R1", year: 2024, revenue_eur: 120, net_profit_eur: null, employees: null, source: "ee" },
      { reg_id: "R1", year: 2025, revenue_eur: 130, net_profit_eur: 5, employees: 3, source: "ee" },
      { reg_id: "NOPE", year: 2025, revenue_eur: 1, net_profit_eur: null, employees: null, source: "ee" },
    ],
  }, "2026-10-05");
  const { data: fin } = await sb.from("mkt_financials").select("year, revenue_eur, verification").eq(
    "company_id",
    co!.id,
  ).order("year");
  assertEquals(fin, [{ year: 2024, revenue_eur: 100, verification: "confirmed" }, {
    year: 2025,
    revenue_eur: 130,
    verification: "official",
  }]);
  const { data: c } = await sb.from("mkt_candidates").select("kind").eq("country", CC);
  assertEquals(c, [{ kind: "financial_update" }]);
});

Deno.test("config upserts chains, companies and sources; ok run stamps last_ok_at", async () => {
  await reset();
  await applyIngest(sb, {
    source: "config",
    country: CC,
    started_at,
    chains: [{ key: "kfc", name: "KFC", segment: "chicken" }, {
      key: "mlinar",
      name: "Mlinar",
      segment: "bakery",
      bakery: true,
    }],
    companies: [{ chain: "kfc", name: "KFC Co", regId: "R1" }],
    sources: [
      { adapter: "osm-overpass", feeds: "locations", cadence: "weekly", mode: "auto" },
      { adapter: "manual", feeds: "financials", cadence: "manual", mode: "blocked", reason: "Fina: login" },
    ],
  }, "2026-10-05");
  await applyIngest(sb, { source: "osm", country: CC, started_at, points: [] }, "2026-10-05");
  const { data: s } = await sb.from("mkt_sources").select("adapter, mode, last_ok_at").eq("country", CC).order(
    "adapter",
  );
  assertEquals(s!.map((x) => [x.adapter, x.mode, x.last_ok_at !== null]), [["manual", "blocked", false], [
    "osm-overpass",
    "auto",
    true,
  ]]);
  const { count } = await sb.from("mkt_chains").select("key", { count: "exact", head: true }).eq("country", CC);
  assertEquals(count, 2);
});
