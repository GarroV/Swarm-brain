import { assertEquals } from "jsr:@std/assert@1";
import { channelOf, matchesCol, per100cm2, pickCell, pizzaPeriods, priceMatrix, refPriceRows, rowBest } from "./marketPizza.ts";
import type { MarketPrice } from "../types.ts";

const p = (chain_key: string, item_type: string, size_cm: number | null, price_eur: number, channel: string, item = "X"): MarketPrice =>
  ({ chain_key, item, item_type, size_cm, price_eur, channel, source: null, seen_on: null });

Deno.test("channel from free text", () => {
  assertEquals(["own website (in-restaurant price)", "Wolt (Ravnice)", "Glovo", null].map(channelOf), ["site", "wolt", "glovo", "other"]);
});

Deno.test("cell is the size closest to 30 cm, regular before promo, with price per 100 cm²", () => {
  const c = pickCell([p("d", "margherita", 25.4, 9.95, "Wolt"), p("d", "margherita", 29.2, 8.45, "Wolt", "Ham (Promo)"), p("d", "margherita", 29.2, 11.45, "Wolt"), p("d", "margherita", 34.3, 13.45, "Wolt")]);
  assertEquals(c, { price: 11.45, cm: 29.2, per100: 1.71, item: "X" });
  assertEquals(per100cm2(8.9, 30), 1.26);
  assertEquals(pickCell([]), null);
});

Deno.test("matrix: columns are chain × channel in chain order, empty pizza types dropped", () => {
  const m = priceMatrix([p("ph", "pepperoni", 30, 12, "own website"), p("dodo", "pepperoni", 30, 9.9, "own website"), p("ph", "pepperoni", 30, 14, "Wolt"), p("dodo", "salad", 30, 5, "own website")], ["dodo", "ph"]);
  assertEquals(m.cols, [{ chain: "dodo", channel: "site" }, { chain: "ph", channel: "site" }, { chain: "ph", channel: "wolt" }]);
  assertEquals(m.rows.map((r) => [r.type, r.cells.map((c) => c?.price ?? null)]), [["pepperoni", [9.9, 12, 14]]]);
});

Deno.test("reference columns: chain, size, channel regex and exclusion; premium prefers four cheese; best is the lowest price", () => {
  const prices = [
    p("pz", "premium", 30, 13, "own site", "Diavola"),
    p("pz", "premium", 30, 12.5, "own site", "Quattro Formaggi"),
    p("pz", "margherita", 30, 9, "own site", "Margherita"),
    p("pz", "margherita", 30, 10.5, "Wolt", "Margherita"),
    p("pz", "margherita", 29, 6, "Wolt", "Margherita Promo"),
    p("pz", "margherita", 29, 8.5, "Wolt", "Margherita"),
    p("other", "margherita", 30, 1, "own site", "Margherita"),
  ];
  const cols = [
    { title: "site", chain: "pz", channel: /own/, cm: 30, exclude: null },
    { title: "wolt", chain: "pz", channel: /^Wolt$/, cm: null, exclude: /Promo/ },
  ];
  const rows = refPriceRows(prices, cols);
  assertEquals(rows.map((r) => [r.type, r.cells.map((c) => c?.price ?? null), r.best]), [
    ["margherita", [9, 10.5], 9],
    ["pepperoni", [null, null], null],
    ["ham_mushroom", [null, null], null],
    ["premium", [12.5, null], 12.5],
  ]);
  assertEquals(matchesCol(p("pz", "margherita", 29, 6, "Wolt", "X Promo"), cols[1]), false);
  assertEquals(rowBest([null, { price: 3, cm: null, per100: null, item: "a" }, { price: 2, cm: null, per100: null, item: "b" }]), 2);
});

Deno.test("pizza table periods: rev and per keys in order of first appearance", () => {
  const row = (rev: Record<string, number | null>, per: Record<string, number | null>) => ({ name: "n", chain: "c", units: "1", entry: "—", rev, per, lfl: "—", note: "" });
  assertEquals(pizzaPeriods([row({ "2023": 1, "2024": 2 }, { "2024": 1 }), row({ "2024": 3, "H1 2025": null }, { "2024": 1, "H1 2025": 2 })]), {
    rev: ["2023", "2024", "H1 2025"],
    per: ["2024", "H1 2025"],
  });
});
