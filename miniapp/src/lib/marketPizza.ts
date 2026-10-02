// Матрица цен пицц по образцу эталона: средняя пицца ~30 см, четыре вида, каждая сеть в
// своих каналах (свой сайт, Wolt, Glovo), с ценой за 100 см² — так сравнимы разные размеры.
import type { MarketPrice } from "../types.ts";

export const PIZZA_TYPES = ["margherita", "pepperoni", "ham_mushroom", "premium"] as const;
export type PizzaType = (typeof PIZZA_TYPES)[number];
const TARGET_CM = 30;

/** Канал из свободного текста источника: «own website (in-restaurant price)» → site. */
export function channelOf(channel: string | null): "site" | "wolt" | "glovo" | "other" {
  const c = (channel ?? "").toLowerCase();
  if (/wolt/.test(c)) return "wolt";
  if (/glovo/.test(c)) return "glovo";
  if (/site|web|own|restaurant|zal|dine/.test(c)) return "site";
  return "other";
}

export type PriceCell = { price: number; cm: number | null; per100: number | null; item: string };
export const per100cm2 = (price: number, cm: number | null) => (cm ? Math.round((price / (Math.PI * (cm / 2) ** 2)) * 100 * 100) / 100 : null);

/** Ячейка: позиция этого вида с размером, ближайшим к 30 см; при равенстве — без «промо»
 *  в названии, затем дешевле. Без размера — только если других нет. */
export function pickCell(prices: MarketPrice[]): PriceCell | null {
  if (!prices.length) return null;
  const promo = (p: MarketPrice) => (/promo|akcij|акци/i.test(p.item) ? 1 : 0);
  const dist = (p: MarketPrice) => (p.size_cm === null ? 1e9 : Math.abs(p.size_cm - TARGET_CM));
  const [best] = [...prices].sort((a, b) => dist(a) - dist(b) || promo(a) - promo(b) || a.price_eur - b.price_eur);
  return { price: best.price_eur, cm: best.size_cm, per100: per100cm2(best.price_eur, best.size_cm), item: best.item };
}

export type PriceColumn = { chain: string; channel: ReturnType<typeof channelOf> };
/** Колонки — сеть × канал, где есть хоть одна цена; строки — четыре вида пиццы. */
export function priceMatrix(prices: MarketPrice[], chainOrder: string[]): { cols: PriceColumn[]; rows: Array<{ type: PizzaType; cells: Array<PriceCell | null> }> } {
  const typed = prices.filter((p) => (PIZZA_TYPES as readonly string[]).includes(p.item_type ?? ""));
  const order = ["site", "wolt", "glovo", "other"];
  const cols = [...new Map(typed.map((p) => [`${p.chain_key}|${channelOf(p.channel)}`, { chain: p.chain_key, channel: channelOf(p.channel) }])).values()]
    .sort((a, b) => chainOrder.indexOf(a.chain) - chainOrder.indexOf(b.chain) || order.indexOf(a.channel) - order.indexOf(b.channel));
  const rows = PIZZA_TYPES.map((type) => ({
    type,
    cells: cols.map((c) => pickCell(typed.filter((p) => p.item_type === type && p.chain_key === c.chain && channelOf(p.channel) === c.channel))),
  })).filter((r) => r.cells.some(Boolean));
  return { cols, rows };
}
