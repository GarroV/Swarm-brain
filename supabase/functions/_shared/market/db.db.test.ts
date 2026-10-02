// Импорт снимка на настоящей базе: повтор не дублирует, загрузка отдаёт то, что импортировали.
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { importSnapshot, loadCountry } from "./db.ts";
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
  for (const t of ["mkt_locations", "mkt_companies", "mkt_prices", "mkt_facts", "mkt_sources"]) {
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
