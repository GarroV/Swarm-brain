import { assertEquals } from "jsr:@std/assert@1";
import { areaOf, freshness, insideRings, pathRings, medianPizza30, orderChannels, revenuePerUnit, unitMonths } from "./marketView.ts";
import type { MarketPrice, MarketRun, MarketSource } from "../types.ts";

const price = (chain_key: string, size_cm: number | null, price_eur: number): MarketPrice => ({
  chain_key,
  item: "x",
  item_type: null,
  size_cm,
  price_eur,
  channel: null,
  source: null,
  seen_on: null,
});

Deno.test("pizza ~30 cm median uses 28–32 cm only, per chain, even count averages", () => {
  const p = [price("a", 30, 10), price("a", 32, 12), price("a", 35, 50), price("a", 25, 1), price("b", 30, 7)];
  assertEquals(medianPizza30(p, "a"), 11);
  assertEquals(medianPizza30([...p, price("a", 28, 20)], "a"), 12);
  assertEquals(medianPizza30(p, "c"), null);
});

Deno.test("revenue per unit divides by months of operation × 12, opening and closing months excluded", () => {
  const locs = [
    { opened: "2020", status: "open", closed: null },
    { opened: "2021", status: "closed", closed: "2023" },
    { opened: "2024-04", status: "open", closed: null },
  ];
  assertEquals(revenuePerUnit({ revenue_eur: 900, year: 2022 }, locs), 450);
  // 2023: 12 мес. + полгода у закрытой (известен только год) = 18 мес.
  assertEquals(revenuePerUnit({ revenue_eur: 900, year: 2023 }, locs), 600);
  // 2024: 12 мес. + май–декабрь у открытой в апреле = 20 мес.
  assertEquals(revenuePerUnit({ revenue_eur: 900, year: 2024 }, locs), 540);
  assertEquals(unitMonths({ opened: "2024-03", status: "closed", closed: "2024-10" }, 2024), 6);
  assertEquals(revenuePerUnit({ revenue_eur: 900, year: 2019 }, locs), null);
  assertEquals(revenuePerUnit({ revenue_eur: null, year: 2022 }, locs), null);
});

Deno.test("revenue per unit is not shown when most of the chain's units have no opening date", () => {
  // Точки из OSM без даты считаются открытыми во все годы: делить выручку 2023 на число
  // точек 2026 значит показать ложную цифру.
  const undated = { opened: null, status: "open", closed: null };
  const locs = [undated, undated, undated, { opened: "2020", status: "open", closed: null }];
  assertEquals(revenuePerUnit({ revenue_eur: 800, year: 2023 }, locs), null);
  assertEquals(revenuePerUnit({ revenue_eur: 800, year: 2023 }, [undated, ...locs.slice(3), locs[3]]), 267);
});

const src = (adapter: string, mode: "auto" | "manual", last_ok_at: string | null): MarketSource => ({
  adapter,
  chain_key: "",
  feeds: "locations",
  cadence: "weekly",
  mode,
  reason: null,
  last_ok_at,
});
const run = (source: string, status: "ok" | "failed", finished_at: string): MarketRun => ({
  source,
  status,
  started_at: finished_at,
  finished_at,
  stats: {},
  error: status === "failed" ? "boom" : null,
});

Deno.test("freshness: last run failed or older than 8 days is bad; manual never is", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const f = freshness(
    [src("ok", "auto", "2026-10-05T00:00:00Z"), src("old", "auto", "2026-09-30T00:00:00Z"), src("fail", "auto", "2026-10-05T00:00:00Z"), src("man", "manual", null)],
    [run("fail", "ok", "2026-10-05T00:00:00Z"), run("fail", "failed", "2026-10-09T00:00:00Z")],
    now,
  );
  assertEquals(f.map((x) => [x.adapter, x.daysAgo, x.bad, x.lastError]), [
    ["ok", 5, false, null],
    ["old", 10, true, null],
    ["fail", 5, true, "boom"],
    ["man", null, false, null],
  ]);
});

Deno.test("order channels drop the internal _days map", () => {
  assertEquals(orderChannels({ site: 3, _days: { "2026-09-01": {} } }), { site: 3 });
  assertEquals(orderChannels(null), {});
});


Deno.test("point in area: parses the generator's path and respects holes", () => {
  const rings = pathRings("M0,0L10,0L10,10L0,10ZM3,3L6,3L6,6L3,6Z");
  assertEquals(rings.length, 2);
  assertEquals([insideRings(rings, [1, 1]), insideRings(rings, [4, 4]), insideRings(rings, [11, 5])], [true, false, false]);
});

Deno.test("area of a point: inside wins, a coastal point just outside goes to the nearest, far away is none", () => {
  const a = { ru: "A", en: "A", rings: pathRings("M0,0L10,0L10,10L0,10Z") };
  const b = { ru: "B", en: "B", rings: pathRings("M40,0L50,0L50,10L40,10Z") };
  assertEquals([areaOf([a, b], [5, 5])?.ru, areaOf([a, b], [14, 5])?.ru, areaOf([a, b], [36, 5])?.ru, areaOf([a, b], [25, 200])], ["A", "A", "B", null]);
});
