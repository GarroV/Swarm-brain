import { assertEquals } from "@std/assert";
import {
  lines,
  parseCountBySource,
  parseDodoUnits,
  parseEcbAnnual,
  parseFinancialMetrics,
  parseOverpass,
} from "./lib.ts";
import { parseEeElements, parseEeReports, parseRoBilant } from "./registry.ts";

const fixture = (name: string) =>
  Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));

Deno.test("parseCountBySource maps Dodo channels to stable keys and drops zeros and total", () => {
  assertEquals(
    parseCountBySource({
      OrdersCountByAggregator: 79,
      OrdersCountByRestaurant: 49,
      OrdersCountByMobile: 20,
      OrdersCountBySite: 1,
      OrdersCountByPhone: 0,
      TotalCount: 149,
    }),
    { aggregator: 79, restaurant: 49, mobile: 20, site: 1 },
  );
});

Deno.test("parseDodoUnits keeps pizzerias only, with coordinates when present", () => {
  assertEquals(parseDodoUnits(JSON.parse(fixture("dodo-units.json"))), [
    {
      name: "Tallinn-1",
      city: "Tallinn",
      address: "Demo 10",
      lat: 59.43,
      lng: 24.76,
      opened: "2015-10-31",
      open: true,
      organization: "Demo OU",
    },
    {
      name: "Tartu-1",
      city: "Tartu",
      address: "Demo 5",
      lat: null,
      lng: null,
      opened: "2019-02-01",
      open: false,
      organization: "Demo OU",
    },
  ]);
});

Deno.test("parseDodoUnits drops the API's placeholder start date", () => {
  // Пиццерия, которая так и не открылась, приходит с BeginDateWork «0001-01-01».
  const [u] = parseDodoUnits([{
    Name: "X",
    Type: 1,
    State: 0,
    BeginDateWork: "0001-01-01T00:00:00",
  }]);
  assertEquals(u.opened, null);
});

Deno.test("parseFinancialMetrics turns previous_month into YYYY-MM", () => {
  assertEquals(
    parseFinancialMetrics({
      response: {
        currency: "EUR",
        previous_month: { revenue: 1234, name: "September", year: 2026 },
        working_pizzerias: 2,
      },
    }),
    { month: "2026-09", amount: 1234, currency: "EUR", units: 2 },
  );
  assertEquals(
    parseFinancialMetrics({
      response: {
        currency: "EUR",
        previous_month: { revenue: 0, name: "?", year: 2026 },
      },
    }),
    null,
  );
});

Deno.test("parseOverpass maps brand case-insensitively and uses way centers", () => {
  const pts = parseOverpass({
    elements: [
      {
        type: "node",
        id: 1,
        lat: 45.8,
        lon: 15.9,
        tags: {
          brand: "KFC",
          name: "KFC Arena",
          "addr:street": "Ilica",
          "addr:housenumber": "1",
        },
      },
      {
        type: "way",
        id: 2,
        center: { lat: 45.7, lon: 15.8 },
        tags: { brand: "mcdonald's" },
      },
      {
        type: "node",
        id: 3,
        lat: 45.6,
        lon: 15.7,
        tags: { brand: "Unknown Café" },
      },
    ],
  }, { kfc: ["KFC"], mcdonalds: ["McDonald's"] });
  assertEquals(pts.map((p) => [p.chain, p.osm_id, p.lat, p.address]), [
    ["kfc", "node/1", 45.8, "Ilica 1"],
    ["mcdonalds", "way/2", 45.7, null],
  ]);
});

Deno.test("Estonia: latest filing per company and year wins; figures from element tags", () => {
  const reports = parseEeReports(
    fixture("ee-reports.csv").split("\n"),
    new Set(["111"]),
  );
  assertEquals([...reports.entries()], [["10", { regId: "111", year: 2024 }], [
    "12",
    { regId: "111", year: 2025 },
  ]]);
  const years = parseEeElements(
    fixture("ee-elements.csv").split("\n"),
    reports,
  );
  assertEquals(
    years.sort((a, b) => a.year - b.year).map((
      y,
    ) => [y.reg_id, y.year, y.revenue_eur, y.net_profit_eur, y.employees]),
    [
      ["111", 2024, 800, null, null],
      ["111", 2025, 1000, -50, 7.5],
    ],
  );
});

Deno.test("Romania: turnover I13, profit I18 minus loss I19, employees I20, RON→EUR", () => {
  const years = parseRoBilant(
    fixture("ro-bilant.txt").split("\n"),
    new Set(["111", "222"]),
    2025,
    4.97,
  );
  assertEquals(
    years.map((y) => [y.reg_id, y.revenue_eur, y.net_profit_eur, y.employees]),
    [
      ["111", 1000, 160.97, 12],
      ["222", 2000, -100, 30],
    ],
  );
});

Deno.test("parseEcbAnnual maps observation index to year", () => {
  const j = JSON.parse(fixture("ecb-ron.json"));
  const r = parseEcbAnnual(j);
  assertEquals(Object.keys(r), ["2023", "2024", "2025"]);
  assertEquals(Math.round(r[2025] * 100) / 100, 5.04);
});

Deno.test("lines splits across chunk borders and strips CR", async () => {
  const enc = new TextEncoder();
  const s = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode("a;1\r\nb;"));
      c.enqueue(enc.encode("2\nc;3"));
      c.close();
    },
  });
  const got: string[] = [];
  for await (const l of lines(s)) got.push(l);
  assertEquals(got, ["a;1", "b;2", "c;3"]);
});
