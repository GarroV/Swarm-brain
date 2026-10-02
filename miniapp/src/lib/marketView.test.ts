import { assertEquals } from "jsr:@std/assert@1";
import { freshness, medianPizza30, orderChannels, revenuePerUnit } from "./marketView.ts";
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

Deno.test("revenue per unit divides by units alive at year end; no units → null", () => {
  const locs = [
    { opened: "2020", status: "open", closed: null },
    { opened: "2021", status: "closed", closed: "2023" },
    { opened: "2024", status: "open", closed: null },
  ];
  assertEquals(revenuePerUnit({ revenue_eur: 900, year: 2022 }, locs), 450);
  assertEquals(revenuePerUnit({ revenue_eur: 900, year: 2023 }, locs), 900);
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

