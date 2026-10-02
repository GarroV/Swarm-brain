import { assertEquals } from "jsr:@std/assert@1";
import { cagr, chainCities, cityShare, datedShare, dodoYoY, dropDeadChains, events, factCards, formatClass, fullOperatingMonths, kpis, openingsByYear, periods, prettyFigures, trend, userNote } from "./marketInsights.ts";
import type { MarketBundle, MarketChain, MarketFact, MarketLocation } from "../types.ts";

const NOW = new Date("2026-10-02T12:00:00Z");
const chain = (key: string, extra: Partial<MarketChain> = {}): MarketChain =>
  ({ key, name: key.toUpperCase(), slot: 0, segment: "burger", is_bakery: false, origin: null, operator: null, first_entry: null, notes: null, hist: null, ...extra });
let n = 0;
const loc = (chain_key: string, opened: string | null, status: MarketLocation["status"] = "open", closed: string | null = null, city = "Zagreb"): MarketLocation =>
  ({ id: String(++n), chain_key, ext_key: String(n), name: `${chain_key}-${n}`, city, address: null, lat: 0, lng: 0, placement: null, opened, opened_estimated: false, status, closed, format: null } as MarketLocation);
const bundle = (b: Partial<MarketBundle>): MarketBundle =>
  ({ country: "HR", chains: [], locations: [], companies: [], financials: [], prices: [], facts: [], dodo: [], runs: [], sources: [], pending: 0, ...b });

Deno.test("periods: early is four full years, recent counts only the months already passed", () => {
  assertEquals(periods(NOW), { early: [2021, 2024], recent: [2025, 2026], earlyMonths: 48, recentMonths: 21 });
});

Deno.test("kpis: bakeries are set aside, closures and undated are counted, top revenue chain beats the rest", () => {
  const b = bundle({
    chains: [chain("mcd"), chain("kfc"), chain("mlinar", { is_bakery: true }), chain("dodo", { first_entry: "2024-03-22" }), chain("taco")],
    locations: [
      loc("mcd", "2019"), loc("mcd", "2022"), loc("mcd", null), loc("mcd", "2018", "closed", "2023"),
      loc("kfc", "2025"), loc("mlinar", "2023"), loc("mlinar", null),
      loc("dodo", "2024-08"), loc("taco", "2026-10-02", "planned"),
    ],
    companies: [{ id: "c1", chain_key: "mcd", name: "GH", reg_id: null, owner: null, notes: null }, { id: "c2", chain_key: "kfc", name: "AR", reg_id: null, owner: null, notes: null }],
    financials: [
      { company_id: "c1", year: 2025, revenue_eur: 262e6, net_profit_eur: null, employees: null, source: null, verification: "official", note: null },
      { company_id: "c2", year: 2025, revenue_eur: 19e6, net_profit_eur: null, employees: null, source: null, verification: "official", note: null },
      { company_id: "c2", year: 2024, revenue_eur: 999e6, net_profit_eur: null, employees: null, source: null, verification: "official", note: null },
    ],
  });
  const k = kpis(b, NOW);
  assertEquals([k.restaurants, k.bakeries, k.bakeryNames], [5, 2, ["MLINAR"]]);
  assertEquals([k.openings, k.closures, k.undated, k.from], [3, 1, 1, 2021]);
  assertEquals(k.newBrands.map((x) => [x.name, x.year, x.planned]), [["DODO", 2024, false], ["KFC", 2025, false], ["TACO", null, true]]);
  assertEquals(k.topRevenue, { name: "MCD", year: 2025, revenue: 262e6, units: 3, othersUnits: 2 });
});

Deno.test("openings by year count only dated non-bakery openings, per chain", () => {
  const locs = [loc("a", "2025-01"), loc("a", "2025"), loc("b", "2025-06"), loc("a", null), loc("bk", "2025", "open", null), loc("b", "2026", "planned")];
  const [y25, y26] = openingsByYear(locs, new Set(["bk"]), [2025, 2026]);
  assertEquals([y25.total, [...y25.byChain]], [3, [["a", 2], ["b", 1]]]);
  assertEquals(y26.total, 0);
});

Deno.test("trend: openings per year in each period, the unfinished period annualised", () => {
  const locs = [loc("a", "2021", "open", null, "Zagreb"), loc("a", "2023", "open", null, "Zagreb"), loc("a", "2025", "open", null, "Split"), loc("a", "2026-05", "open", null, "Split"), loc("a", "2026", "open", null, "Zagreb")];
  const rows = trend(locs, new Set(), periods(NOW), (l) => l.city);
  // Загреб: 2 за 48 мес. = 0,5 в год; 1 за 21 мес. ≈ 0,6. Сплит: 0 → 2 за 21 мес. ≈ 1,1.
  assertEquals(rows, [{ group: "Split", early: 0, recent: 1.1 }, { group: "Zagreb", early: 0.5, recent: 0.6 }]);
});

Deno.test("events: first point of a chain is its entry, closures and deals are dated, older ones dropped", () => {
  const b = bundle({
    chains: [chain("a"), chain("bk", { is_bakery: true })],
    locations: [loc("a", "2020-07"), loc("a", "2021-03"), loc("a", "2019-01", "closed", "2022-05"), loc("bk", "2022")],
    facts: [{ topic: "deal", date: "2022-06-15", text: "DP buys A", value: null, source: null }, { topic: "deal", date: "2010-04 (context)", text: "old", value: null, source: null }],
  });
  assertEquals(events(b, 2020).map((e) => [e.date, e.kind]), [["2020-07", "open"], ["2021-03", "open"], ["2022-05", "close"], ["2022-06-15", "deal"]]);
  // Самая ранняя точка 2019 закрыта, но она и есть вход сети: 2020-07 — уже не вход.
  const first = events(b, 2019)[0];
  assertEquals([first.date, first.kind, first.chain, first.text.endsWith(", Zagreb")], ["2019-01", "entry", "a", true]);
});

Deno.test("dodo y/y compares the same full months only, at most three, never the running month", () => {
  const m = (month: string, revenue_eur: number | null, complete = true, units = 2) => ({ month, revenue_local: null, currency: null, revenue_eur, units, orders: null, complete });
  const dodo = [m("2025-04", 30), m("2025-05", 100), m("2025-06", 100), m("2025-07", 100, true, 1), m("2025-08", 100), m("2026-04", 50), m("2026-05", 90), m("2026-06", 90), m("2026-07", 84), m("2026-10", 10, false)];
  assertEquals(dodoYoY(dodo, NOW), { months: ["2026-05", "2026-06", "2026-07"], change: -12, units: [1, 2] });
  assertEquals(dodoYoY([m("2026-05", 90)], NOW), null);
});

Deno.test("city share of dated openings in a period", () => {
  const locs = [loc("a", "2025", "open", null, "Zagreb"), loc("a", "2026", "open", null, "Split"), loc("a", "2026", "open", null, "Split"), loc("a", null, "open", null, "Zagreb")];
  assertEquals(cityShare(locs, new Set(), [2025, 2026], "Zagreb"), 33);
  assertEquals(cityShare(locs, new Set(), [2021, 2024], "Zagreb"), null);
});

Deno.test("format buckets from free text", () => {
  const f = ["drive-thru", "mall food court", "highway", "casual grill restaurant (sit-down)", "sushi bar (largely inside Interspar hypermarkets and malls)", null];
  assertEquals(f.map((x) => formatClass(x)), ["drive", "mall", "highway", "street", "mall", null]);
  assertEquals([formatClass("street", "KFC Mall of Split"), formatClass(null, "McDonald's Dugopolje A1"), formatClass(null, "Batak Savica")], ["mall", "highway", null]);
});

Deno.test("dead chains disappear everywhere, an announced-only chain stays", () => {
  const b = bundle({ chains: [chain("gone"), chain("live"), chain("soon")], locations: [loc("gone", "2019", "closed", "2023"), loc("live", "2020"), loc("soon", "2026-10", "planned")] });
  const d = dropDeadChains(b);
  assertEquals([d.chains.map((c) => c.key), d.locations.map((l) => l.chain_key)], [["live", "soon"], ["live", "soon"]]);
});

Deno.test("Dodo months: opening, paused and running months are not full months of work; order coverage does not matter", () => {
  const m = (month: string, revenue_eur: number | null, complete = true) => ({ month, revenue_local: null, currency: null, revenue_eur, units: 1, orders: null, complete });
  const d = [m("2024-03", 5), m("2024-04", 40), m("2024-05", 45), m("2024-06", 0), m("2024-07", 20), m("2024-08", 44), m("2024-09", 50, false), m("2026-08", 30), m("2026-09", 40), m("2026-10", 9)];
  assertEquals(fullOperatingMonths(d, NOW).map((x) => x.month), ["2024-04", "2024-05", "2024-08", "2024-09", "2026-09"]);
});

Deno.test("cagr spans first to last year with revenue, skips gaps, needs two points", () => {
  assertEquals(cagr([[2021, 102.1], [2022, null], [2025, 262.5]]), 27);
  assertEquals(cagr([[2024, 0.31], [2025, 0.84]]), 171);
  assertEquals(cagr([[2025, 9]]), null);
});

Deno.test("cagr ignores a ramp-up base below a tenth of the last value", () => {
  assertEquals(cagr([[2023, 0.11], [2024, 3.2], [2025, 6.4]]), 100);
  assertEquals(cagr([[2024, 0.11], [2025, 6.4]]), null);
});

Deno.test("prettyFigures localises money, thousands and decimals for Russian", () => {
  assertEquals(prettyFigures("revenue €2479392, stores 7, LFL 7.8%", true), "revenue €2,48 млн, stores 7, LFL 7,8%");
  assertEquals(prettyFigures("EUR 32.0m / 39.2m", true), "€32,0 млн / 39,2 млн");
  assertEquals(prettyFigures("14,351 firms", true), "14 351 firms");
  assertEquals(prettyFigures("EUR 1,161/month", true), "€1 161/month");
  assertEquals(prettyFigures("EUR 3.65bn", false), "€3.65bn");
});

Deno.test("factCards keeps the newest of a series, drops stale, long and empty ones", () => {
  const f = (value: string | null, text: string, date: string | null) => ({ topic: "market", value, text, date, source: null }) as MarketFact;
  const cards = factCards([
    f("revenue €1908101", "Domino's Pizza: H1 2025", "H1 2025"),
    f("revenue €2479392, system sales €2600000, stores 7, LFL 7.8%", "Domino's Pizza: H1 2026", "H1 2026"),
    f("revenue €1822096, stores 5", "Domino's Pizza: H1 2024", "H1 2024"),
    f("HRK 550M", "Fast food market size", "c.2019"),
    f("not found", "No evidence", "2026"),
    f("EUR 2.7bn revenue; 8,466 businesses", "Food service market size", "2025"),
    f("1 Globalna hrana 232.9M; 2 Pleter 42.7M; 3 Filia 37.3M; 4 Nautika 21.2M; 5 Virtuoz 20M", "Ranking", "2024"),
  ], NOW, true);
  assertEquals(cards.map((c) => c.head), ["revenue €2,48 млн", "€2,70 млрд revenue"]);
  assertEquals(cards[0].more, "system sales €2,60 млн; stores 7; LFL 7,8%");
  assertEquals(cards[1].more, "8 466 businesses");
});

Deno.test("userNote strips audit and file-path remarks and caps the length", () => {
  assertEquals(userNote("7 open stores; no closures found. AUDIT 2026-10-01: previous version wrong. See data/_verify.json."), "7 open stores; no closures found.");
  assertEquals(userNote("Added in audit 2026-10-01. CAUTION: x."), null);
  assertEquals(userNote("a".repeat(200))!.length, 141);
});

Deno.test("chain cities merge spellings with and without diacritics", () => {
  const locs = [loc("a", "2020", "open", null, "București"), loc("a", "2021", "open", null, "Bucuresti"), loc("a", "2021", "open", null, "București"), loc("a", "2022", "open", null, "Vaslui")];
  assertEquals(chainCities(locs, "a", 2026), ["București", "Vaslui"]);
});

Deno.test("dated share counts operating non-bakery locations with a known opening year", () => {
  const locs = [loc("a", "2020"), loc("a", null), loc("a", null), loc("b", "2021"), loc("a", "2019", "closed", "2020")];
  assertEquals(datedShare(locs, new Set(["b"]), 2026), 33);
});
