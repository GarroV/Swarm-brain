import { assertAlmostEquals, assertEquals } from "@std/assert";
import { parseCurrentMonth } from "./finmetrics.ts";
import { buildMtd, clearMtdCache, loadMtd, pacePct } from "./mtd.ts";

const RS = {
  response: {
    currency: "RSD",
    current_month_progressive_total: 2931688,
    previous_month: { revenue: 27971296, name: "October", year: 2026 },
    today_progressive_total: 592196,
    working_pizzerias: 4,
  },
};

Deno.test("parseCurrentMonth: reads month-to-date, full days and previous month", () => {
  assertEquals(parseCurrentMonth(RS), {
    currency: "RSD",
    mtd: 2931688,
    fullDays: 2931688 - 592196,
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
        today_progressive_total: 1,
        previous_month: { revenue: 1, name: "?", year: 2026 },
      },
    }),
    null,
  );
});

Deno.test("pacePct: average full day against average previous-month day", () => {
  // 4 полных дня по 100 против прошлого месяца 31 день по 50 → +100%
  assertAlmostEquals(pacePct(400, 5, 1550, 31)!, 100, 1e-9);
  // 31/сут в этом месяце и 961/31 = 31/сут в прошлом → 0
  assertAlmostEquals(pacePct(310, 11, 961, 31)!, 0, 1e-9);
});

Deno.test("pacePct: 1st of the month has no full days; empty previous month gives null", () => {
  assertEquals(pacePct(0, 1, 1000, 31), null);
  assertEquals(pacePct(100, 5, 0, 31), null);
});

Deno.test("buildMtd: converts by rate and computes pace (5 Nov, RS at 117 RSD/EUR)", () => {
  const m = buildMtd(parseCurrentMonth(RS)!, 117, "2026-11-05")!;
  assertEquals(m.as_of, "2026-11-05");
  assertAlmostEquals(m.revenue_eur, 2931688 / 117, 1e-6);
  assertAlmostEquals(m.prev_month_eur, 27971296 / 117, 1e-6);
  // 2339492 за 4 полных дня = 584873/сут против 27971296/31 = 902299/сут
  assertAlmostEquals(m.pace_pct!, ((2339492 / 4) / (27971296 / 31) - 1) * 100, 1e-9);
});

Deno.test("buildMtd: 1st of the month has null pace; EUR rate 1 keeps the numbers", () => {
  const cm = parseCurrentMonth({
    response: {
      currency: "EUR",
      current_month_progressive_total: 500,
      today_progressive_total: 500,
      previous_month: { revenue: 9000, name: "October", year: 2026 },
    },
  })!;
  const m = buildMtd(cm, 1, "2026-11-01")!;
  assertEquals(m.pace_pct, null);
  assertEquals(m.revenue_eur, 500);
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
        today_progressive_total: 200,
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
          today_progressive_total: 0,
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
