import { assertEquals } from "jsr:@std/assert@1";
import { chainCounts, chainOrder, chainSlots, fitBox, makeVb, type MapFilters, nearByChain, openBucket, pickOpenYear, topCities, visibleLocations } from "./marketMap.ts";
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
  const ls = [loc("b", "crumbs", "2022"), loc("x", "k", null), loc("y", "k", "2024")];
  const bakery = new Set(["crumbs"]);
  assertEquals(ids(visibleLocations(ls, bakery, base)), ["x", "y"]);
  assertEquals(ids(visibleLocations(ls, bakery, { ...base, bakeries: true })), ["b", "x", "y"]);
  assertEquals(ids(visibleLocations(ls, bakery, { ...base, hidden: new Set(["k"]) })), []);
  assertEquals(ids(visibleLocations(ls, bakery, { ...base, openYears: new Set(["pre"]) })), ["x"]);
  assertEquals(openBucket({ opened: "2019-05" }, 2021), "pre");
});

Deno.test("top cities count visible points and split them by chain, biggest first", () => {
  const ls = [loc("1", "a", null, "open", null, "Northport"), loc("2", "b", null, "open", null, "Northport"), loc("3", "b", null, "open", null, "Northport"), loc("4", "a", null, "open", null, "Sunvale")];
  assertEquals(topCities(ls), [
    { city: "Northport", total: 3, byChain: [["b", 2], ["a", 1]] },
    { city: "Sunvale", total: 1, byChain: [["a", 1]] },
  ]);
});

Deno.test("bakeries get a free colour only after regular chains, however big they are", () => {
  const chains = [{ key: "crumbs", is_bakery: true }, { key: "grill", is_bakery: false }];
  const s = chainSlots(chains, new Map([["crumbs", 271], ["grill", 29]]));
  assertEquals([s.get("grill"), s.get("crumbs")], [1, 2]);
});

Deno.test("city bar segments follow the chain rank when one is given", () => {
  const ls = [loc("1", "a", null, "open", null, "Northport"), loc("2", "b", null, "open", null, "Northport"), loc("3", "b", null, "open", null, "Northport")];
  const rank = (k: string) => ({ a: 1, b: 5 } as Record<string, number>)[k];
  assertEquals(topCities(ls, 10, rank)[0].byChain, [["a", 1], ["b", 2]]);
});

Deno.test("opening-year picks: from all keeps one, toggles after, empty or full falls back to all", () => {
  const all = ["pre", "2021", "2022"];
  const one = pickOpenYear(null, "2021", all);
  assertEquals([...one!], ["2021"]);
  assertEquals([...pickOpenYear(one, "pre", all)!].sort(), ["2021", "pre"]);
  assertEquals(pickOpenYear(one, "2021", all), null);
  assertEquals(pickOpenYear(new Set(["pre", "2021"]), "2022", all), null);
});

Deno.test("chip counts take open and paused points only", () => {
  const ls = [loc("1", "a", null), loc("2", "a", null, "paused"), loc("3", "a", null, "closed"), loc("4", "a", null, "planned"), loc("5", "b", null)];
  assertEquals([...chainCounts(ls)], [["a", 2], ["b", 1]]);
});

Deno.test("view box: width is clamped, fitBox pads the short side to the map aspect and centres", () => {
  assertEquals(makeVb(0, 0, 5, 100, 50), { x: 0, y: 0, w: 20, h: 10 });
  assertEquals(makeVb(0, 0, 500, 100, 50).w, 120);
  // 40×10 на карте 2:1 → высота добирается до 20, центр остаётся (30; 15)
  assertEquals(fitBox(10, 10, 50, 20, 100, 50), { x: 10, y: 5, w: 40, h: 20 });
  assertEquals(fitBox(50, 20, 10, 10, 100, 50), { x: 10, y: 5, w: 40, h: 20 });
});

Deno.test("cursor radius counts points strictly inside and groups them by chain", () => {
  const pts = [{ x: 0, y: 0, chain: "a" }, { x: 3, y: 0, chain: "b" }, { x: 0, y: 3, chain: "b" }, { x: 5, y: 0, chain: "a" }];
  assertEquals(nearByChain(pts, 0, 0, 5), { n: 3, byChain: [["b", 2], ["a", 1]] });
});

Deno.test("chainSlots: catalogue slot is kept only while free, no two chains share a colour", () => {
  const chains = [
    { key: "dodo", is_bakery: false, slot: 2 },
    { key: "pizzaplanet", is_bakery: false, slot: 2 },
    { key: "burgerbarn", is_bakery: false, slot: 3 },
    { key: "subway", is_bakery: false, slot: 7 },
    { key: "spartan", is_bakery: false, slot: 7 },
  ];
  const counts = new Map([["pizzaplanet", 30], ["burgerbarn", 10], ["subway", 5], ["spartan", 1]]);
  const s = chainSlots(chains, counts);
  assertEquals(s.get("dodo"), 2);
  assertEquals(s.get("burgerbarn"), 3);
  assertEquals(s.get("subway"), 7);
  const all = [...s.values()];
  assertEquals(new Set(all).size, all.length);
});

Deno.test("chips follow the reference: coloured chains by colour slot, then grey ones by name, bakeries last", () => {
  const ch = (key: string, name: string, is_bakery = false) => ({ key, name, is_bakery });
  const chains = [ch("tutto", "TuttoBene"), ch("mlinar", "Mlinar", true), ch("dodo", "Dodo"), ch("biberon", "Biberon"), ch("mcd", "McDonald's"), ch("batak", "Batak")];
  const slots = new Map([["mcd", 1], ["dodo", 2], ["batak", 8], ["tutto", 0], ["biberon", 0], ["mlinar", 0]]);
  assertEquals(chainOrder(chains, slots).map((c) => c.key), ["mcd", "dodo", "batak", "biberon", "tutto", "mlinar"]);
});
