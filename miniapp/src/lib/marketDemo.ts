// Demoland (XD) — выдуманная страна «Анализа рынка» для демо и DEV_MODE (решение владельца
// 02.10.2026: «в демо давай зальем рыбу, не надо официальную информацию»). Ни одна сеть,
// город, юрлицо и цифра здесь не настоящие. Генерация детерминирована (свой ГПСЧ с зерном),
// поэтому демо одинаково при каждом заходе; этот же генератор пишет seed-demo
// (scripts/market/demoland-seed.ts), чтобы демо на сервере и DEV_MODE совпадали.
import type {
  MarketBundle,
  MarketChain,
  MarketCompany,
  MarketDodoMonth,
  MarketFact,
  MarketFinancial,
  MarketLocation,
  MarketPrice,
} from "../types.ts";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Города в открытом океане (контур — public/market/shapes/XD.json): ни с какой реальной
// страной точки не перепутать. Название, lat, lng, вес (сколько точек тянет город).
export const CITIES: Array<[string, number, number, number]> = [
  ["Northport", 45.1, -33.6, 9],
  ["Ravenmoor", 44.2, -34.2, 5],
  ["Sunvale", 43.7, -32.4, 4],
  ["Elmsby", 44.8, -31.9, 3],
  ["Coralbay", 43.5, -34.0, 2],
];

type DemoChain = Omit<MarketChain, "hist"> & { start: number; perYear: number; closeRate: number };
const chain = (
  key: string,
  name: string,
  slot: number,
  segment: string,
  operator: string,
  start: number,
  perYear: number,
  closeRate: number,
): DemoChain => ({
  key,
  name,
  slot,
  segment,
  is_bakery: segment === "bakery",
  origin: null,
  operator,
  first_entry: String(start),
  notes: null,
  start,
  perYear,
  closeRate,
});
const CHAINS: DemoChain[] = [
  chain("dodo", "Dodo Pizza", 1, "pizza", "Dodo franchisee (demo)", 2019, 1.6, 0),
  chain("pizzaplanet", "Pizza Planet", 2, "pizza", "Planet Foods Ltd", 2012, 1.4, 0.08),
  chain("burgerbarn", "Burger Barn", 3, "burger", "Barn Restaurants XD", 2008, 1.5, 0.04),
  chain("cluckhouse", "Cluck House", 4, "chicken", "Cluck Partners", 2016, 1.2, 0.05),
  chain("bloom", "Bakery Bloom", 5, "bakery", "Bloom Baking Co", 2005, 2.4, 0.1),
  chain("wokwave", "Wok Wave", 6, "asian", "Wave Kitchens", 2020, 0.8, 0.15),
];
const LAST_YEAR = 2025;
const STREETS = ["Harbor St", "Mill Rd", "Market Sq", "Lantern Ave", "Oak Lane", "Pier Rd", "Station Pl", "High St"];

function pickCity(r: () => number) {
  const weight = CITIES.reduce((s, c) => s + c[3], 0);
  let x = r() * weight;
  for (const c of CITIES) if ((x -= c[3]) <= 0) return c;
  return CITIES[0];
}

function location(r: () => number, ch: DemoChain, n: number, year: number): MarketLocation {
  const [city, la, ln] = pickCity(r);
  const closes = r() < ch.closeRate ? Math.min(LAST_YEAR, year + 1 + Math.floor(r() * 4)) : null;
  const month = String(1 + Math.floor(r() * 12)).padStart(2, "0");
  const dodo = ch.key === "dodo";
  return {
    id: `xd-${ch.key}-${n}`,
    chain_key: ch.key,
    ext_key: `${ch.key}:${n}`,
    name: `${ch.name} ${city}${n > 1 ? ` ${n}` : ""}`,
    city,
    address: `${1 + Math.floor(r() * 120)} ${STREETS[Math.floor(r() * STREETS.length)]}`,
    lat: Math.round((la + (r() - 0.5) * 0.35) * 1e5) / 1e5,
    lng: Math.round((ln + (r() - 0.5) * 0.5) * 1e5) / 1e5,
    placement: r() < 0.3 ? "mall" : "street",
    opened: `${year}-${month}`,
    opened_estimated: !dodo && r() < 0.25,
    status: closes ? "closed" : "open",
    closed: closes ? String(closes) : null,
    format: null,
    source: null,
    source_kind: dodo ? "dodo" : r() < 0.4 ? "osm" : "snapshot",
    verification: dodo ? "internal" : r() < 0.6 ? "official" : "unverified",
    verification_note: null,
    missing_weeks: 0,
    first_seen_at: "2026-09-01T00:00:00Z",
    last_seen_at: "2026-09-28T23:00:00Z",
  };
}

function locations(r: () => number): MarketLocation[] {
  const out: MarketLocation[] = [];
  for (const ch of CHAINS) {
    let n = 0;
    for (let y = ch.start; y <= LAST_YEAR; y++) {
      const opened = Math.floor(ch.perYear + r());
      for (let i = 0; i < opened; i++) out.push(location(r, ch, ++n, y));
    }
  }
  return out;
}

function money(r: () => number): { companies: MarketCompany[]; financials: MarketFinancial[] } {
  const companies: MarketCompany[] = [];
  const financials: MarketFinancial[] = [];
  CHAINS.forEach((ch, i) => {
    const id = `xd-co-${ch.key}`;
    companies.push({
      id,
      chain_key: ch.key,
      name: ch.operator ?? ch.name,
      reg_id: `XD-${100200 + i * 7}`,
      owner: null,
      notes: null,
    });
    let rev = 1_200_000 + r() * 6_000_000;
    for (let y = 2021; y <= LAST_YEAR; y++) {
      rev *= 1.04 + r() * 0.18;
      const margin = -0.04 + r() * 0.12;
      financials.push({
        company_id: id,
        year: y,
        revenue_eur: Math.round(rev),
        net_profit_eur: Math.round(rev * margin),
        employees: Math.round(rev / 55_000),
        source: null,
        verification: y === LAST_YEAR && i % 2 ? "unverified" : "official",
        note: null,
      });
    }
  });
  return { companies, financials };
}

function prices(r: () => number): MarketPrice[] {
  const items = ["Margherita", "Pepperoni", "Four Cheese"];
  return CHAINS.filter((c) => c.segment === "pizza").flatMap((ch) =>
    items.flatMap((item) =>
      [25, 30, 35].map((size) => ({
        chain_key: ch.key,
        item,
        item_type: "pizza",
        size_cm: size,
        price_eur: Math.round((6 + size * 0.22 + r() * 2.5) * 100) / 100,
        channel: "site",
        source: null,
        seen_on: "2026-09-15",
      }))
    )
  );
}

const fact = (topic: MarketFact["topic"], date: string | null, text: string, value: string | null = null) => ({
  topic,
  date,
  text,
  value,
  source: null,
});
const FACTS: MarketFact[] = [
  fact("delivery", "2025", "Two aggregators split the delivery market: FoodDash and Rolli", "≈70% / 30%"),
  fact("delivery", "2025", "Online share of QSR orders", "≈28%"),
  fact("timeline", "2021-04", "Rolli enters Demoland"),
  fact("timeline", "2024-09", "FoodDash launches own couriers in Northport"),
  fact("market", "2025", "QSR market size (estimate)", "€410m"),
  fact("insight", null, "Pizza Planet closes more units than it opens since 2023"),
];

export const DODO_MONTHS = 18;
/** Месяцы и даты запусков — от «сейчас»: демо всегда выглядит свежим, а не застывшим на дне
 *  генерации (сид на сервере пересчитывает их так же, от now()). */
const daysAgoIso = (now: Date, d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

function dodoMonths(r: () => number, now: Date): MarketDodoMonth[] {
  const out: MarketDodoMonth[] = [];
  let rev = 180_000;
  for (let i = 0; i < DODO_MONTHS; i++) {
    const back = DODO_MONTHS - 1 - i;
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
    rev *= 1.01 + r() * 0.05;
    const total = Math.round(rev / 21);
    const aggregator = Math.round(total * (0.38 + r() * 0.06));
    const site = Math.round(total * 0.22), mobile = Math.round(total * 0.25);
    out.push({
      month,
      revenue_local: Math.round(rev),
      currency: "EUR",
      revenue_eur: Math.round(rev),
      units: 6 + Math.floor(i / 6),
      orders: { aggregator, site, mobile, restaurant: Math.max(0, total - aggregator - site - mobile) },
      complete: back > 0,
    });
  }
  return out;
}

const run = (source: string, at: string, stats: Record<string, number>, error: string | null = null) => ({
  source,
  status: error ? "failed" as const : "ok" as const,
  started_at: at,
  finished_at: at,
  stats,
  error,
});
const source = (
  adapter: string,
  feeds: "locations" | "financials" | "dodo" | "prices" | "facts",
  cadence: "weekly" | "monthly" | "manual",
  last_ok_at: string,
) => ({
  adapter,
  chain_key: "",
  feeds,
  cadence,
  mode: cadence === "manual" ? "manual" as const : "auto" as const,
  reason: null,
  last_ok_at,
});

/** Возраст запусков и источников в днях — общий для DEV_MODE и сида. */
export const DEMO_AGES = { dodo: 3, osm: 3, registry: 26, registryFailed: 5, manual: 17 };

export function demolandBundle(now: Date = new Date()): MarketBundle {
  const at = (d: number) => daysAgoIso(now, d);
  const r = rng(20261002);
  const locs = locations(r);
  const { companies, financials } = money(r);
  return {
    country: "XD",
    chains: CHAINS.map(({ start: _s, perYear: _p, closeRate: _c, ...c }) => ({ ...c, hist: null })),
    locations: locs,
    companies,
    financials,
    prices: prices(r),
    facts: FACTS,
    dodo: dodoMonths(r, now),
    runs: [
      run("dodo-publicapi", at(DEMO_AGES.dodo), { units: 7, days: 8 }),
      run("osm-overpass", at(DEMO_AGES.osm), { points: 41, matched: 39, new_candidates: 2, maybe_closed: 0 }),
      run("xd-registry", at(DEMO_AGES.registryFailed), {}, "registry site returned HTTP 503"),
    ],
    sources: [
      source("dodo-publicapi", "dodo", "weekly", at(DEMO_AGES.dodo)),
      source("osm-overpass", "locations", "weekly", at(DEMO_AGES.osm)),
      source("xd-registry", "financials", "monthly", at(DEMO_AGES.registry)),
      source("manual", "prices", "manual", at(DEMO_AGES.manual)),
      source("manual", "facts", "manual", at(DEMO_AGES.manual)),
    ],
    pending: 0,
  };
}
