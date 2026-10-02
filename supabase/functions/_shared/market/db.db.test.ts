// Импорт снимка на настоящей базе: повтор не дублирует, загрузка отдаёт то, что импортировали.
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { acceptAllNewLocations, decideCandidate, importSnapshot, loadCountry } from "./db.ts";
import { validateSnapshot } from "./snapshot.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CC = "QA"; // тестовая страна (QA–QZ — пользовательские коды ISO), реальные не трогаем

const raw = {
  chains: [{ key: "kfc", name: "KFC", slot: 2, segment: "chicken", bakery: false, hist: [{ year: 2025, count: 2 }] }],
  locs: [
    { c: "kfc", n: "KFC One", city: "A", a: "St 1", lat: 45.8, lng: 15.9, s: "open", o: "2020", v: "official" },
    {
      c: "kfc",
      n: "KFC Two",
      city: "A",
      a: "St 2",
      lat: 45.81,
      lng: 15.91,
      s: "closed",
      o: "2019",
      cl: "2024",
      v: "confirmed",
    },
  ],
  fin: {
    companies: [{ chain: "KFC", company: "KFC Co", oib: "1", years: [{ year: 2025, revenue_eur: 5, v: "confirmed" }] }],
  },
  prices: { items: [{ chain: "KFC", pizza: "Bucket", price_eur: 9, cm: null, channel: null }] },
  delivery: { facts: [{ fact: "Wolt big", value: "x", year: 2025 }] },
};

async function wipe() {
  const { data: cos } = await sb.from("mkt_companies").select("id").eq("country", CC);
  const ids = (cos ?? []).map((r) => r.id);
  if (ids.length) await sb.from("mkt_financials").delete().in("company_id", ids);
  for (const t of ["mkt_candidates", "mkt_locations", "mkt_companies", "mkt_prices", "mkt_facts", "mkt_sources"]) {
    await sb.from(t).delete().eq("country", CC);
  }
  await sb.from("mkt_chains").delete().eq("country", CC);
}

Deno.test("import is idempotent and loadCountry returns it", async () => {
  await wipe();
  const v = validateSnapshot(raw);
  if (!v.ok) throw new Error(v.errors.join("; "));
  const first = await importSnapshot(sb, CC, v.snapshot);
  const second = await importSnapshot(sb, CC, v.snapshot);
  assertEquals(first, second);
  const b = await loadCountry(sb, CC);
  assertEquals(b.locations.length, 2);
  assertEquals(b.chains.map((c) => [c.key, c.hist]), [["kfc", [{ year: 2025, count: 2, source: null }]]]);
  assertEquals(b.financials.length, 1);
  assertEquals(b.prices.length, 1);
  assertEquals(b.facts.length, 1);
  // Ручные источники отмечены как обновлённые этим импортом.
  assertEquals(b.sources.map((s) => [s.adapter, s.feeds, s.mode]).sort(), [
    ["manual", "facts", "manual"],
    ["manual", "financials", "manual"],
    ["manual", "locations", "manual"],
    ["manual", "prices", "manual"],
  ]);
  await wipe();
});

Deno.test("loadCountry returns more than the 1000-row PostgREST page", async () => {
  await wipe();
  await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC" });
  const rows = Array.from({ length: 1100 }, (_, i) => ({
    country: CC,
    chain_key: "kfc",
    ext_key: `k${i}`,
    name: `KFC ${i}`,
    lat: 45 + i / 10000,
    lng: 15,
    status: "open",
    verification: "official",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("mkt_locations").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  assertEquals((await loadCountry(sb, CC)).locations.length, 1100);
  await wipe();
});

const cand = (i: number) => ({
  country: CC,
  kind: "new_location",
  source: "osm",
  payload: {
    key: `kfc:${i}`,
    row: { chain_key: "kfc", ext_key: `kfc:${i}`, name: `KFC ${i}`, lat: 45 + i / 100, lng: 15, status: "open" },
  },
});

Deno.test("bulk accept of OSM finds keeps them unverified; a single accept confirms", async () => {
  await wipe();
  await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC" });
  const { data, error } = await sb.from("mkt_candidates").insert([cand(1), cand(2), cand(3)]).select("id");
  if (error) throw new Error(error.message);
  await sb.from("mkt_candidates").insert({ country: CC, kind: "maybe_closed", source: "osm", payload: { key: "x" } });
  assertEquals(await decideCandidate(sb, data![0].id, true, 1), "ok");
  assertEquals(await acceptAllNewLocations(sb, CC, 1), 2);
  const locs = (await loadCountry(sb, CC)).locations as Array<
    { ext_key: string; verification: string; source_kind: string }
  >;
  assertEquals(
    locs.map((l) => [l.ext_key, l.verification, l.source_kind]).sort(),
    [["kfc:1", "confirmed", "osm"], ["kfc:2", "unverified", "osm"], ["kfc:3", "unverified", "osm"]],
  );
  // Принимаются только находки точек: «возможно закрыта» требует решения по одной.
  const { count } = await sb.from("mkt_candidates").select("id", { count: "exact", head: true })
    .eq("country", CC).eq("status", "pending");
  assertEquals(count, 1);
  assertEquals(await acceptAllNewLocations(sb, CC, 1), 0);
  await wipe();
});

Deno.test("snapshot import skips Dodo points once the Dodo API owns them in the country", async () => {
  await wipe();
  const snap = {
    chains: [{ key: "dodo", name: "Dodo Pizza", slot: 1, segment: "pizza" }],
    locs: [{ c: "dodo", n: "Dodo One", city: "A", a: "St 1", lat: 45.8, lng: 15.9, s: "open", v: "internal" }],
  };
  const v = validateSnapshot(snap);
  if (!v.ok) throw new Error(v.errors.join("; "));
  await importSnapshot(sb, CC, v.snapshot);
  assertEquals((await loadCountry(sb, CC)).locations.length, 1);
  await sb.from("mkt_locations").update({ ext_key: "dodo:One" }).eq("country", CC);
  await importSnapshot(sb, CC, v.snapshot);
  const locs = (await loadCountry(sb, CC)).locations as Array<{ ext_key: string }>;
  assertEquals(locs.map((l) => l.ext_key), ["dodo:One"]);
  await wipe();
});

Deno.test("bulk accept handles more finds than fit in one request URL", async () => {
  await wipe();
  await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC" });
  const { error } = await sb.from("mkt_candidates").insert(Array.from({ length: 400 }, (_, i) => cand(i)));
  if (error) throw new Error(error.message);
  assertEquals(await acceptAllNewLocations(sb, CC, 1), 400);
  assertEquals((await loadCountry(sb, CC)).pending, 0);
  await wipe();
});
