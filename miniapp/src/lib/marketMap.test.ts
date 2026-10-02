import { assertEquals } from "jsr:@std/assert@1";
import { chainSlots, type MapFilters, openBucket, topCities, visibleLocations } from "./marketMap.ts";
import type { MarketLocation } from "../types.ts";

const loc = (id: string, chain_key: string, opened: string | null, status: MarketLocation["status"] = "open", closed: string | null = null, city = "A"): MarketLocation => ({
  id,
  chain_key,
  ext_key: id,
  name: id,
  city,
  address: null,
  lat: 0,
  lng: 0,
  placement: null,
  opened,
  opened_estimated: false,
  status,
  closed,
  format: null,
} as MarketLocation);

const base: MapFilters = { year: 2026, thisYear: 2026, hidden: new Set(), bakeries: false, planned: true, openYears: null, firstYear: 2021 };
const ids = (ls: MarketLocation[]) => ls.map((l) => l.id).sort();

Deno.test("known chains keep their colour, the rest get free slots by size, overflow is grey", () => {
  const chains = ["dodo", "a", "b", "c", "mcdonalds"].map((key) => ({ key, is_bakery: false }));
  const s = chainSlots(chains, new Map([["a", 1], ["b", 9], ["c", 5]]));
  assertEquals([s.get("mcdonalds"), s.get("dodo"), s.get("b"), s.get("c"), s.get("a")], [1, 2, 3, 4, 5]);
  const many = Array.from({ length: 10 }, (_, i) => ({ key: `x${i}`, is_bakery: false }));
  assertEquals(chainSlots(many, new Map()).get("x9"), 0);
});

Deno.test("year slider: closed before the year is gone, opened later is not yet there, paused counts", () => {
  const ls = [loc("old", "k", "2019"), loc("shut", "k", "2019", "closed", "2023"), loc("new", "k", "2025"), loc("pause", "k", "2020", "paused")];
  assertEquals(ids(visibleLocations(ls, new Set(), { ...base, year: 2022 })), ["old", "pause", "shut"]);
  assertEquals(ids(visibleLocations(ls, new Set(), base)), ["new", "old", "pause"]);
});

Deno.test("announced points show only on the current year and when the box is on", () => {
  const ls = [loc("plan", "k", "2027", "planned")];
  assertEquals(visibleLocations(ls, new Set(), base).length, 1);
  assertEquals(visibleLocations(ls, new Set(), { ...base, planned: false }).length, 0);
  assertEquals(visibleLocations(ls, new Set(), { ...base, year: 2025 }).length, 0);
});

Deno.test("bakeries hidden unless enabled; hidden chains hidden; open-year filter by bucket", () => {
  const ls = [loc("b", "mlinar", "2022"), loc("x", "k", null), loc("y", "k", "2024")];
  const bakery = new Set(["mlinar"]);
  assertEquals(ids(visibleLocations(ls, bakery, base)), ["x", "y"]);
  assertEquals(ids(visibleLocations(ls, bakery, { ...base, bakeries: true })), ["b", "x", "y"]);
  assertEquals(ids(visibleLocations(ls, bakery, { ...base, hidden: new Set(["k"]) })), []);
  assertEquals(ids(visibleLocations(ls, bakery, { ...base, openYears: new Set(["pre"]) })), ["x"]);
  assertEquals(openBucket({ opened: "2019-05" }, 2021), "pre");
});

Deno.test("top cities count visible points and split them by chain, biggest first", () => {
  const ls = [loc("1", "a", null, "open", null, "Zagreb"), loc("2", "b", null, "open", null, "Zagreb"), loc("3", "b", null, "open", null, "Zagreb"), loc("4", "a", null, "open", null, "Split")];
  assertEquals(topCities(ls), [
    { city: "Zagreb", total: 3, byChain: [["b", 2], ["a", 1]] },
    { city: "Split", total: 1, byChain: [["a", 1]] },
  ]);
});

Deno.test("bakeries get a free colour only after regular chains, however big they are", () => {
  const chains = [{ key: "mlinar", is_bakery: true }, { key: "grill", is_bakery: false }];
  const s = chainSlots(chains, new Map([["mlinar", 271], ["grill", 29]]));
  assertEquals([s.get("grill"), s.get("mlinar")], [1, 2]);
});
