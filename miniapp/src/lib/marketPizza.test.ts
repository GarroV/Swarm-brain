import { assertEquals } from "jsr:@std/assert@1";
import { channelOf, per100cm2, pickCell, priceMatrix } from "./marketPizza.ts";
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
