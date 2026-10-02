import { assertEquals, assertThrows } from "@std/assert";
import {
  lines,
  parseCountBySource,
  parseDodoUnits,
  parseEcbAnnual,
  parseFinancialMetrics,
  parseNbsAverage,
  parseOverpass,
  srLatin,
} from "./lib.ts";
import {
  parseCompanyWall,
  parseEeElements,
  parseEeReports,
  parseRoBilant,
} from "./registry.ts";

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

Deno.test("parseOverpass refuses a timed-out answer instead of returning a partial list", () => {
  // Overpass отдаёт таймаут как HTTP 200 с remark и обрезанным списком.
  assertThrows(
    () =>
      parseOverpass({
        remark:
          'runtime error: Query timed out in "query" at line 3 after 181 seconds.',
        elements: [],
      }, { kfc: ["KFC"] }),
    Error,
    "timed out",
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

Deno.test("parseOverpass matches chains without a brand tag by name prefix, Cyrillic too", () => {
  const pts = parseOverpass(
    {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 44.8,
          lon: 20.4,
          tags: { name: "Скроз добра пекара Врачар", shop: "bakery" },
        },
        {
          type: "node",
          id: 2,
          lat: 44.8,
          lon: 20.4,
          tags: { name: "Walter", amenity: "fast_food" },
        },
        {
          type: "node",
          id: 3,
          lat: 44.8,
          lon: 20.4,
          tags: { name: "Walterova kuća", amenity: "restaurant" },
        },
        {
          type: "node",
          id: 4,
          lat: 44.8,
          lon: 20.4,
          tags: { brand: "KFC", name: "Walter KFC" },
        },
      ],
    },
    { kfc: ["KFC"] },
    { skroz: ["Skroz dobra pekara", "Скроз добра пекара"], walter: ["Walter"] },
  );
  assertEquals(pts.map((p) => [p.osm_id, p.chain]), [["node/1", "skroz"], [
    "node/2",
    "walter",
  ], ["node/4", "kfc"]]);
});

Deno.test("parseNbsAverage averages the NBS middle rate over the days of that month only", () => {
  const r = (date: string, exchange_middle: number) => ({
    code: "EUR",
    date,
    exchange_middle,
  });
  const j = {
    rates: [r("2026-09-01", 117), r("2026-09-30", 118), r("2026-10-01", 200)],
  };
  assertEquals(parseNbsAverage(j, "2026-09"), 117.5);
  assertEquals(parseNbsAverage({ rates: [] }, "2026-09"), null);
});

Deno.test("parseCompanyWall reads total income and employees per year, checks the registry id, drops a repeated last year", () => {
  const page =
    `<div>PIB 108918724 MB 21093564</div><p>Preuzmi finansijske podatke Preuzmi &nbsp; </p><span>2023</span> <span>2024 2025</span> Ukupni prihodi 3.061.881.000,00 3.910.846.000,00 4.713.945.000,00 Ukupni rashodi 1,00 2,00 3,00</p>
    <p>Ebitda 1,00 2,00 3,00 Broj zaposlenih 561,00 762,00 870,00 Prosečna</p>`;
  const rate = (y: number) => (y === 2025 ? 117 : 117.2);
  const ys = parseCompanyWall(page, "21093564", "https://cw/x", rate);
  assertEquals(ys.map((y) => [y.year, y.revenue_eur, y.employees]), [
    [2023, 26125265, 561],
    [2024, 33368993, 762],
    [2025, 40290128, 870],
  ]);
  assertEquals(ys[0].net_profit_eur, null);
  assertThrows(
    () => parseCompanyWall(page, "99999999", "u", rate),
    Error,
    "MB",
  );
  const stale = page.replace("4.713.945.000,00", "3.910.846.000,00");
  assertEquals(
    parseCompanyWall(stale, "21093564", "u", rate).map((y) => y.year),
    [2023, 2024],
  );
});

Deno.test("srLatin transliterates Serbian Cyrillic, digraphs included, and leaves Latin alone", () => {
  assertEquals(
    srLatin("Нови Београд, Љиљана Џаковић"),
    "Novi Beograd, Ljiljana Džaković",
  );
  assertEquals(srLatin("Čačak"), "Čačak");
});

Deno.test("parseOverpass: city from the address in one script, else the nearest town within 15 km", () => {
  const node = (
    id: number,
    lat: number,
    lon: number,
    tags: Record<string, string>,
  ) => ({ type: "node", id, lat, lon, tags });
  const pts = parseOverpass(
    {
      elements: [
        node(1, 44.817, 20.457, {
          place: "city",
          name: "Београд",
          "name:sr-Latn": "Beograd",
          "name:en": "Belgrade",
        }),
        node(2, 45.255, 19.845, { place: "city", name: "Нови Сад" }),
        node(10, 44.80, 20.47, { brand: "KFC" }),
        node(11, 45.25, 19.84, { brand: "KFC", "addr:city": "нови сад" }),
        node(12, 44.81, 20.40, { brand: "KFC", "addr:city": "Нови Београд" }),
        node(14, 44.79, 20.45, { brand: "KFC", "addr:city": "Belgrade" }),
        node(13, 43.32, 21.90, { brand: "KFC" }),
      ],
    },
    { kfc: ["KFC"] },
    {},
    { toLatin: srLatin },
  );
  assertEquals(pts.map((p) => [p.osm_id, p.city]), [
    ["node/10", "Beograd"],
    ["node/11", "Novi Sad"],
    ["node/12", "Novi Beograd"],
    ["node/14", "Beograd"],
    ["node/13", null],
  ]);
});

Deno.test("parseOverpass: a Serbian spelling tag never renames towns of other countries", () => {
  const [p] = parseOverpass({
    elements: [
      {
        type: "node",
        id: 1,
        lat: 47.16,
        lon: 27.58,
        tags: { place: "city", name: "Iași", "name:sr-Latn": "Jaši" },
      },
      { type: "node", id: 2, lat: 47.161, lon: 27.581, tags: { brand: "KFC" } },
    ],
  }, { kfc: ["KFC"] });
  assertEquals(p.city, "Iași");
});

Deno.test("parseOverpass: a city within range beats a nearer suburb town; a town counts only with no city near", () => {
  const n = (
    id: number,
    lat: number,
    lon: number,
    tags: Record<string, string>,
  ) => ({ type: "node", id, lat, lon, tags });
  const pts = parseOverpass({
    elements: [
      n(1, 44.817, 20.457, { place: "city", name: "Beograd" }),
      n(2, 44.70, 20.47, { place: "town", name: "Pinosava" }),
      n(3, 44.99, 20.08, { place: "town", name: "Stara Pazova" }),
      n(10, 44.71, 20.47, { brand: "KFC" }),
      n(11, 44.99, 20.09, { brand: "KFC" }),
    ],
  }, { kfc: ["KFC"] });
  assertEquals(pts.map((p) => p.city), ["Beograd", "Stara Pazova"]);
});

Deno.test("parseOverpass: a wrong brand tag on another business is dropped; Cyrillic and branch names stay", () => {
  const n = (id: number, tags: Record<string, string>) => ({
    type: "node",
    id,
    lat: 45,
    lon: 15,
    tags,
  });
  const pts = parseOverpass({
    elements: [
      n(1, { brand: "Pizza Hut", name: "Me Gutsa IBO pizza" }),
      n(2, { brand: "Pizza Hut", name: "Pizza Hut Arena" }),
      n(3, { brand: "Starbucks", name: "Старбакс" }),
      n(4, { brand: "Pizza Hut" }),
      n(5, { brand: "McDonald's", name: "McDonalds Pula" }),
    ],
  }, {
    pizzahut: ["Pizza Hut"],
    starbucks: ["Starbucks"],
    mcdonalds: ["McDonald's"],
  });
  assertEquals(pts.map((p) => p.osm_id), [
    "node/2",
    "node/3",
    "node/4",
    "node/5",
  ]);
});
