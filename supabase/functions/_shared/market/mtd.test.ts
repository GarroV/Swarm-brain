import { assertAlmostEquals, assertEquals } from "@std/assert";
import { parseCurrentMonth } from "./finmetrics.ts";
import { buildMtd, clearMtdCache, loadMtd } from "./mtd.ts";

const RS = {
  response: {
    currency: "RSD",
    current_month_progressive_total: 2931688,
    previous_month: { revenue: 27971296, name: "October", year: 2026 },
    working_pizzerias: 4,
  },
};

Deno.test("parseCurrentMonth: reads month-to-date, currency and previous month", () => {
  assertEquals(parseCurrentMonth(RS), {
    currency: "RSD",
    mtd: 2931688,
    prevMonth: "2026-10",
    prevRevenue: 27971296,
  });
});

Deno.test("parseCurrentMonth: missing totals or bad previous month give null", () => {
  assertEquals(parseCurrentMonth({ response: { currency: "EUR" } }), null);
  assertEquals(
    parseCurrentMonth({
      response: {
        current_month_progressive_total: 1,
        previous_month: { revenue: 1, name: "?", year: 2026 },
      },
    }),
    null,
  );
});

Deno.test("buildMtd: converts month-to-date by the rate (5 Nov, RS at 117 RSD/EUR)", () => {
  const m = buildMtd(parseCurrentMonth(RS)!, 117, "2026-11-05")!;
  assertEquals(m.as_of, "2026-11-05");
  assertAlmostEquals(m.revenue_eur, 2931688 / 117, 1e-6);
  assertEquals(Object.keys(m).sort(), ["as_of", "revenue_eur"]);
});

Deno.test("buildMtd: EUR rate 1 keeps the numbers", () => {
  const cm = parseCurrentMonth({
    response: {
      currency: "EUR",
      current_month_progressive_total: 500,
      previous_month: { revenue: 9000, name: "October", year: 2026 },
    },
  })!;
  assertEquals(buildMtd(cm, 1, "2026-11-01")?.revenue_eur, 500);
});

Deno.test("buildMtd: Dodo has not rolled the month over yet gives null; January looks at December", () => {
  assertEquals(buildMtd(parseCurrentMonth(RS)!, 117, "2026-12-01"), null);
  const dec = { ...parseCurrentMonth(RS)!, prevMonth: "2026-12" };
  assertEquals(buildMtd(dec, 117, "2027-01-03")?.as_of, "2027-01-03");
});

Deno.test("loadMtd: failing country is null, others survive; second call hits the cache", async () => {
  clearMtdCache();
  let calls = 0;
  const getJson = (url: string) => {
    calls++;
    if (url.includes("/si/")) return Promise.reject(new Error("timeout"));
    return Promise.resolve({
      response: {
        currency: "EUR",
        current_month_progressive_total: 1000,
        previous_month: { revenue: 9000, name: "October", year: 2026 },
      },
    });
  };
  const now = () => new Date("2026-11-05T12:00:00Z");
  const r = await loadMtd(["BG", "SI"], { getJson, now });
  assertEquals(r.BG?.revenue_eur, 1000);
  assertEquals(r.SI, null);
  await loadMtd(["BG", "SI"], { getJson, now });
  assertEquals(calls, 2);
  clearMtdCache();
});

Deno.test("loadMtd: currency without a rate source gives null instead of throwing", async () => {
  clearMtdCache();
  const getJson = (url: string) =>
    url.includes("publicapi.dodois.io")
      ? Promise.resolve({
        response: {
          currency: "ZZZ",
          current_month_progressive_total: 1,
          previous_month: { revenue: 1, name: "October", year: 2026 },
        },
      })
      : Promise.reject(new Error("HTTP 404"));
  const r = await loadMtd(["TJ"], { getJson, now: () => new Date("2026-11-05T12:00:00Z") });
  assertEquals(r.TJ, null);
  clearMtdCache();
});

Deno.test("loadMtd: dinar converts at the latest NBS rate not later than today", async () => {
  clearMtdCache();
  const getJson = (url: string) =>
    Promise.resolve(
      url.includes("publicapi.dodois.io") ? RS : {
        rates: [
          { date: "2026-11-04", exchange_middle: 100 },
          { date: "2026-11-05", exchange_middle: 117.6018 },
          { date: "2026-11-06", exchange_middle: 1 },
        ],
      },
    );
  const r = await loadMtd(["RS"], { getJson, now: () => new Date("2026-11-05T12:00:00Z") });
  assertAlmostEquals(r.RS!.revenue_eur, 2931688 / 117.6018, 1e-6);
  clearMtdCache();
});
