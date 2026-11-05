import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  clearUnitSalesCache,
  loadUnitSales,
  loadVisibleUnitSales,
  mergeCountryMtd,
  parseDecimusSales,
} from "./unit-sales.ts";
import { buildUnitSales } from "./unit-sales.ts";

// Фикстура — ответ GET /api/v1/sales?countries=RS,SI&month=2026-11 из реального запроса к базе Децимуса
// (06.11.2026, чтение): те же пиццерии и суммы, что отдаёт `swarm_read.unit_sales`, + loaded из metric_loads.
const REAL = {
  month: "2026-11",
  units: [
    {
      id: "11f004bc8b23bd3a10d3edd76d0a7510",
      name: "Belgrade-1",
      cc: "RS",
      revenue: 330737.0,
      orders: 164,
      currency: "RSD",
    },
    {
      id: "11f11ef488021b90509de8601e5b00d0",
      name: "Belgrade-2",
      cc: "RS",
      revenue: 1027785.0,
      orders: 648,
      currency: "RSD",
    },
    {
      id: "f2a374866439aba811edad0235f5a235",
      name: "Novi Sad-1",
      cc: "RS",
      revenue: 875470.0,
      orders: 617,
      currency: "RSD",
    },
    {
      id: "11efd6a3b25827a3a79c4a2425592ff0",
      name: "Novi Sad-2",
      cc: "RS",
      revenue: 697696.0,
      orders: 584,
      currency: "RSD",
    },
    {
      id: "76c13c596caa978911ee64736ea86365",
      name: "Koper-1",
      cc: "SI",
      revenue: 4134.62,
      orders: 273,
      currency: "EUR",
    },
    {
      id: "000d3a23750ca95c11e915ab0763c302",
      name: "Ljubljana-1",
      cc: "SI",
      revenue: 10182.76,
      orders: 656,
      currency: "EUR",
    },
    {
      id: "f2dcb314c89faa8611ed31208835ddd3",
      name: "Ljubljana-2",
      cc: "SI",
      revenue: 8697.37,
      orders: 567,
      currency: "EUR",
    },
    {
      id: "11f02781a4448bb980b3663005b640a0",
      name: "Ljubljana-3",
      cc: "SI",
      revenue: 5660.77,
      orders: 320,
      currency: "EUR",
    },
  ],
  loaded: { RS: "2026-11-05T09:53:32Z", SI: "2026-11-05T09:53:41Z" },
};
const RATES = { RSD: 117, EUR: 1 };

Deno.test("parseDecimusSales: real response parses; garbage is null, not half an answer", () => {
  assertEquals(parseDecimusSales(REAL)?.units.length, 8);
  assertEquals(parseDecimusSales({ month: "2026-11" }), null);
  assertEquals(parseDecimusSales({ ...REAL, units: [{ id: 1, cc: "RS" }] }), null);
  assertEquals(parseDecimusSales(null), null);
});

Deno.test("buildUnitSales: RS converts by the dinar rate, SI stays in euro, country = sum of its pizzerias", () => {
  const r = buildUnitSales(parseDecimusSales(REAL)!, RATES);
  assertAlmostEquals(r.units["11f004bc8b23bd3a10d3edd76d0a7510"], 330737 / 117, 0.005);
  assertEquals(r.units["76c13c596caa978911ee64736ea86365"], 4134.62);
  assertAlmostEquals(r.countries.RS, (330737 + 1027785 + 875470 + 697696) / 117, 0.005);
  assertAlmostEquals(r.countries.SI, 4134.62 + 10182.76 + 8697.37 + 5660.77, 0.005);
  // Сумма страны сходится с суммой пиццерий в строках (с точностью до копеек округления).
  const sumRs = Object.entries(r.units).filter(([id]) => REAL.units.find((u) => u.id === id)?.cc === "RS")
    .reduce((s, [, v]) => s + v, 0);
  assertAlmostEquals(r.countries.RS, sumRs, 0.02);
  assertEquals(r.loaded, REAL.loaded);
});

Deno.test("buildUnitSales: no currency, no rate or no successful load drops the whole country (no partial sums)", () => {
  const parsed = parseDecimusSales({
    ...REAL,
    units: [...REAL.units, { id: "aa".repeat(16), name: "X-1", cc: "ZZ", revenue: null, orders: 5, currency: null }],
  })!;
  const noRate = buildUnitSales(parsed, { EUR: 1 }); // динарного курса нет
  assertEquals(Object.keys(noRate.countries), ["SI"]);
  assertEquals("aa".repeat(16) in noRate.units, false);
  const noLoad = buildUnitSales({ ...parsed, loaded: { SI: REAL.loaded.SI } }, RATES);
  assertEquals(Object.keys(noLoad.countries), ["SI"]);
  assertEquals(buildUnitSales(parsed, { RSD: 0, EUR: 1 }).countries.RS, undefined);
});

Deno.test("mergeCountryMtd: Decimus sum wins for its countries, public API stays for the rest, null stays null", () => {
  const us = buildUnitSales(parseDecimusSales(REAL)!, RATES);
  const pub = {
    RS: { as_of: "2026-11-06", revenue_eur: 1 },
    HR: { as_of: "2026-11-06", revenue_eur: 777 },
    XD: null,
  };
  const m = mergeCountryMtd(pub, us);
  assertEquals(m.RS?.source, "decimus");
  assertEquals(m.RS?.as_of, "2026-11-05");
  assertAlmostEquals(m.RS!.revenue_eur, us.countries.RS, 1e-9);
  assertEquals(m.HR, { as_of: "2026-11-06", revenue_eur: 777, source: "dodo_public" });
  assertEquals(m.XD, null);
  assertEquals(mergeCountryMtd(pub, null).RS, { as_of: "2026-11-06", revenue_eur: 1, source: "dodo_public" });
});

Deno.test("loadUnitSales: month in Belgrade, rates per currency, cached 10 minutes; failure is null and cached too", async () => {
  clearUnitSalesCache();
  const calls: Array<[string[], string]> = [];
  let rateCalls = 0;
  const deps = {
    getSales: (ccs: string[], month: string) => {
      calls.push([ccs, month]);
      return Promise.resolve(REAL);
    },
    rateOf: (cur: string) => {
      rateCalls++;
      return Promise.resolve(RATES[cur as "RSD" | "EUR"]);
    },
    now: () => new Date("2026-11-06T10:00:00Z"),
  };
  const a = await loadUnitSales(["RS", "SI"], deps);
  await loadUnitSales(["SI", "RS"], deps);
  assertEquals(calls, [[["RS", "SI"], "2026-11"]]);
  assertEquals(rateCalls, 2);
  assertAlmostEquals(a!.countries.RS, 2931688 / 117, 0.005);
  // 10 минут спустя — снова в Децимус.
  await loadUnitSales(["RS", "SI"], { ...deps, now: () => new Date("2026-11-06T10:11:00Z") });
  assertEquals(calls.length, 2);

  clearUnitSalesCache();
  const failing = { ...deps, getSales: () => Promise.reject(new Error("boom")) };
  assertEquals(await loadUnitSales(["RS"], failing), null);
  assertEquals(await loadUnitSales([], deps), null);
});

Deno.test("loadUnitSales: a currency without a rate only drops its own countries", async () => {
  clearUnitSalesCache();
  const r = await loadUnitSales(["RS", "SI"], {
    getSales: () => Promise.resolve(REAL),
    rateOf: (cur: string) => cur === "EUR" ? Promise.resolve(1) : Promise.reject(new Error("no rate")),
    now: () => new Date("2026-11-06T10:00:00Z"),
  });
  assertEquals(Object.keys(r!.countries), ["SI"]);
});

Deno.test("loadVisibleUnitSales: Decimus is asked only for visible countries; demo and invisible-only requests never call it", async () => {
  clearUnitSalesCache();
  const asked: string[][] = [];
  const deps = {
    getSales: (ccs: string[]) => {
      asked.push(ccs);
      return Promise.resolve(REAL);
    },
    rateOf: () => Promise.resolve(1),
    now: () => new Date("2026-11-06T10:00:00Z"),
  };
  const real = (cc: string) => cc !== "XD";
  const demo = (cc: string) => cc === "XD";
  // Настоящее пространство: демо-страна и чужое по видимости отсечены до запроса.
  await loadVisibleUnitSales(["RS", "XD", "SI"], (c) => real(c) && c !== "SI", false, deps);
  assertEquals(asked, [["RS"]]);
  // Демо-пространство: ни при каких странах.
  assertEquals(await loadVisibleUnitSales(["XD", "RS"], demo, true, deps), null);
  assertEquals(await loadVisibleUnitSales(["RS"], real, true, deps), null);
  // Ничего видимого — тоже без запроса.
  assertEquals(await loadVisibleUnitSales(["RS"], () => false, false, deps), null);
  assertEquals(asked.length, 1);
});
