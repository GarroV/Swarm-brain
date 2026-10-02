import { assertEquals } from "@std/assert";
import { type SnapshotResult, validateSnapshot } from "./snapshot.ts";
import type { Snapshot } from "./types.ts";

const ok = (r: SnapshotResult): Snapshot => {
  if (!r.ok) throw new Error(`ожидался валидный снимок: ${r.errors.join("; ")}`);
  return r.snapshot;
};
const errs = (r: SnapshotResult): string[] => {
  if (r.ok) throw new Error("ожидался отказ");
  return r.errors;
};

const chain = {
  key: "dominos",
  name: "Domino's",
  slot: 1,
  segment: "pizza",
  bakery: false,
  origin: "US",
  operator: "X d.o.o.",
  first_entry: "2019",
  notes: null,
};
const loc = {
  c: "dominos",
  n: "Domino's Zagreb",
  city: "Zagreb",
  a: "Ilica 1",
  lat: 45.81,
  lng: 15.97,
  p: "street",
  o: "2019-05",
  oy: 2019,
  est: false,
  s: "open",
  cl: null,
  cy: null,
  f: "delivery",
  src: "https://x",
  v: "official",
  vn: null,
};
const base = { chains: [chain], locs: [loc] };

Deno.test("accepts the Croatia file format and maps short keys", () => {
  const s = ok(validateSnapshot(base));
  assertEquals(s.locations[0], {
    chain: "dominos",
    name: "Domino's Zagreb",
    city: "Zagreb",
    address: "Ilica 1",
    lat: 45.81,
    lng: 15.97,
    placement: "street",
    opened: "2019-05",
    opened_estimated: false,
    status: "open",
    closed: null,
    format: "delivery",
    source: "https://x",
    verification: "official",
    verification_note: null,
  });
});

Deno.test("rejects snapshot without chains", () => {
  const e = errs(validateSnapshot({ locs: [] }));
  assertEquals(e, ["chains: обязателен непустой массив"]);
});

Deno.test("rejects location of unknown chain and coordinates out of range", () => {
  const e = errs(validateSnapshot({ chains: [chain], locs: [{ ...loc, c: "ghost" }, { ...loc, lat: 145 }] }));
  assertEquals(e, ["locs[0]: сеть «ghost» не объявлена в chains", "locs[1]: координаты вне диапазона"]);
});

Deno.test("rejects a chain key declared twice", () => {
  const e = errs(validateSnapshot({ chains: [chain, { ...chain, name: "Other" }], locs: [loc] }));
  assertEquals(e, ["chains[1]: ключ «dominos» уже объявлен"]);
});

Deno.test("a price listed twice under one key is imported once, the later row wins", () => {
  // Две одинаковые строки цены валили upsert в Postgres уже после записи сетей и точек.
  const item = { chain: "Domino's", pizza: "Margherita", cm: 30, channel: "site" };
  const s = ok(validateSnapshot({
    ...base,
    prices: { seen: "2026-09-01", items: [{ ...item, price_eur: 9 }, { ...item, price_eur: 10 }] },
  }));
  assertEquals(s.prices.map((p) => p.price_eur), [10]);
});

Deno.test("rejects unknown status and verification", () => {
  const e = errs(validateSnapshot({ chains: [chain], locs: [{ ...loc, s: "gone", v: "maybe" }] }));
  assertEquals(e, ["locs[0]: статус «gone» неизвестен", "locs[0]: статус проверки «maybe» неизвестен"]);
});

Deno.test("maps fin companies, prices, delivery facts and leaves dodo to the collector", () => {
  const s = ok(validateSnapshot({
    ...base,
    fin: {
      companies: [{
        chain: "Domino's",
        company: "X d.o.o.",
        oib: "123",
        owner: null,
        notes: null,
        years: [{
          year: 2025,
          revenue_eur: 1000,
          net_profit_eur: 10,
          employees: 5,
          source: "fina",
          v: "confirmed",
          v_note: null,
        }],
      }],
      market: [{ fact: "QSR market", value: "€1bn", year: "2025", source: "s" }],
      deals: [{ date: "2024-01", description: "deal", source: "s" }],
    },
    prices: {
      seen: "2026-10-01",
      items: [{
        chain: "Domino's",
        pizza: "Margherita",
        pizza_type: "margherita",
        size: "30 cm",
        cm: 30,
        price_eur: 9.5,
        channel: "wolt",
        source: "s",
      }],
    },
    delivery: {
      facts: [{ topic: "Wolt", fact: "Wolt revenue", value: "€30m", year: 2025, source: "s" }],
      timeline: [{ date: "2019-01", event: "Wolt enters", source: "s" }],
      insights: ["note"],
    },
    dodo: [{ m: "2025-01", usd: 100, fx: 0.9, eur: 90, units: 2, per: 45 }],
  }));
  assertEquals(s.companies[0].chain, "dominos");
  assertEquals(s.companies[0].years[0].verification, "confirmed");
  assertEquals(s.prices[0], {
    chain: "dominos",
    item: "Margherita",
    item_type: "margherita",
    size_cm: 30,
    price_eur: 9.5,
    channel: "wolt",
    source: "s",
    seen_on: "2026-10-01",
  });
  assertEquals(s.facts.map((f) => f.topic), ["market", "deal", "delivery", "timeline", "insight"]);
  // Продажи Dodo — не ручной источник: их доливает сборщик из publicapi.
  assertEquals(s.dodo, []);
});

Deno.test("chain hist and yearly pizzafin periods are kept; half-years become facts", () => {
  const s = ok(validateSnapshot({
    chains: [{ ...chain, hist: [{ year: 2025, count: 7, source: "press" }] }],
    locs: [loc],
    fin: {
      companies: [{
        chain: "Domino's",
        company: "X d.o.o.",
        oib: "123",
        years: [{ year: 2024, revenue_eur: 1, v: "confirmed" }],
      }],
    },
    pizzafin: {
      chains: [{
        chain: "Domino's Pizza",
        company: "X d.o.o. (100% DP Poland PLC)",
        oib: "123",
        periods: [
          { period: "2025", revenue_eur: 2000, net_profit_eur: -5, employees: null, source: "fina" },
          { period: "2026 H1", system_sales_eur: 900, source: "dpp" },
        ],
      }],
      commentary: [{ chain: "Domino's", quote_or_fact: "LFL +7.8%", source: "dpp" }],
    },
  }));
  assertEquals(s.chains[0].hist, [{ year: 2025, count: 7, source: "press" }]);
  assertEquals(s.companies.length, 1);
  assertEquals(s.companies[0].years.map((y) => [y.year, y.revenue_eur]), [[2024, 1], [2025, 2000]]);
  assertEquals(s.facts.map((f) => [f.topic, f.date]), [["market", "2026 H1"], ["commentary", null]]);
});

Deno.test("company chain names with notes in brackets still match; empty companies are dropped", () => {
  const s = ok(validateSnapshot({
    chains: [chain, { ...chain, key: "leggiero", name: "Leggiero / Leggiero Food" }],
    locs: [loc],
    fin: {
      companies: [
        {
          chain: "Leggiero (cafe/bar chain)",
          company: "Virtuoz d.o.o.",
          oib: "1",
          years: [{ year: 2024, revenue_eur: 1 }],
        },
        {
          chain: "Domino's Pizza (DP Poland)",
          company: "All About Pizza",
          oib: "2",
          years: [{ year: 2024, revenue_eur: 1 }],
        },
        { chain: "Subway", company: "not identified", years: [] },
      ],
    },
  }));
  assertEquals(s.companies.map((c) => [c.name, c.chain]), [["Virtuoz d.o.o.", "leggiero"], [
    "All About Pizza",
    "dominos",
  ]]);
});
