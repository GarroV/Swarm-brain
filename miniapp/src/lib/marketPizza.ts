// Матрица цен пицц по образцу эталона: средняя пицца ~30 см, четыре вида, каждая сеть в
// своих каналах (свой сайт, Wolt, Glovo), с ценой за 100 см² — так сравнимы разные размеры.
import type { MarketPrice } from "../types.ts";
import type { EdPizzaRow, EdPriceCol } from "./marketEditorial.ts";

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

/** Колонки периодов таблицы пицц — ключи rev/per в порядке появления по строкам. */
export function pizzaPeriods(rows: EdPizzaRow[]): { rev: string[]; per: string[] } {
  const keys = (pick: (r: EdPizzaRow) => Record<string, number | null>) => [...new Set(rows.flatMap((r) => Object.keys(pick(r))))];
  return { rev: keys((r) => r.rev), per: keys((r) => r.per) };
}

/** Позиция колонки ручной части: та же сеть, размер (если задан), канал по регулярке (если
 *  задан), без исключённых по названию. */
export function matchesCol(p: MarketPrice, c: EdPriceCol): boolean {
  if (p.chain_key !== c.chain) return false;
  if (c.cm !== null && p.size_cm !== c.cm) return false;
  if (c.channel && !c.channel.test(p.channel ?? "")) return false;
  return !(c.exclude && c.exclude.test(p.item));
}

const PREMIUM_NAME = /4|Four|Quattro|Cinque/;

/** Матрица цен по колонкам ручной части, как pick() эталона: первая подходящая позиция вида,
 *  у премиума — сначала «четыре сыра». best — самая низкая цена в строке. */
export function refPriceRows(prices: MarketPrice[], cols: EdPriceCol[]): Array<{ type: PizzaType; cells: Array<PriceCell | null>; best: number | null }> {
  return PIZZA_TYPES.map((type) => {
    const cells = cols.map((c) => {
      const cand = prices.filter((p) => p.item_type === type && matchesCol(p, c));
      const hit = type === "premium" ? cand.find((p) => PREMIUM_NAME.test(p.item)) ?? cand[0] : cand[0];
      return hit ? { price: hit.price_eur, cm: hit.size_cm, per100: per100cm2(hit.price_eur, hit.size_cm), item: hit.item } : null;
    });
    return { type, cells, best: rowBest(cells) };
  });
}

/** Самая низкая цена в строке вычисленной матрицы — подсветка как в эталоне. */
export const rowBest = (cells: Array<PriceCell | null>): number | null => {
  const vals = cells.filter((c): c is PriceCell => c !== null).map((c) => c.price);
  return vals.length ? Math.min(...vals) : null;
};
