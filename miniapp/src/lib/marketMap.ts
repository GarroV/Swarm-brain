// Логика карты «Анализа рынка» — по образцу хорватского референса (решение владельца
// 02.10.2026, docs/decisions/2026-10-02-market-follow-reference-visual.md): какие точки видны
// при фильтрах, цвет сети, топ городов. Без React — под тестами.
import type { MarketChain, MarketLocation } from "../types.ts";
import { aliveAtYearEnd } from "./marketStats";

/** Цвет сети — слот 1..8 палитры `--mkt-s*`, 0 — серый «прочие». Крупные международные сети
 *  держат свой цвет во всех странах (McDonald's всегда синий, Dodo — оранжевый), остальным
 *  свободные слоты раздаются по числу точек — сперва обычным сетям, потом пекарням: пекарни по
 *  умолчанию скрыты и не должны отнимать цвет у видимых сетей. */
export const KNOWN_SLOT: Record<string, number> = { mcdonalds: 1, dodo: 2, kfc: 3, burgerking: 4, dominos: 5, pizzahut: 6 };
const SLOTS = 8;

/** Слоты цвета сетей: международные — всегда своим (KNOWN_SLOT), остальные — слотом справочника,
 *  пока он свободен (крупная сеть первой), прочие — первым свободным по числу точек. Два цвета не совпадают. */
export function chainSlots(chains: Array<Pick<MarketChain, "key" | "is_bakery"> & { slot?: number }>, counts: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  const take = (key: string, s: number) => {
    out.set(key, s);
    used.add(s);
  };
  for (const c of chains) if (KNOWN_SLOT[c.key]) take(c.key, KNOWN_SLOT[c.key]);
  const rest = chains.filter((c) => !out.has(c.key)).sort((a, b) => Number(a.is_bakery) - Number(b.is_bakery) || (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
  for (const c of rest) if (c.slot && c.slot >= 1 && c.slot <= SLOTS && !used.has(c.slot)) take(c.key, c.slot);
  const free = Array.from({ length: SLOTS }, (_, i) => i + 1).filter((s) => !used.has(s));
  for (const c of rest) if (!out.has(c.key)) out.set(c.key, free.shift() ?? 0);
  return out;
}


/** Корзина года открытия: «до первого года / без даты» или сам год. */
export const PRE = "pre";
export function openBucket(l: Pick<MarketLocation, "opened">, firstYear: number): string {
  const y = Number(l.opened?.slice(0, 4));
  return Number.isFinite(y) && y >= firstYear ? String(y) : PRE;
}

export type MapFilters = {
  year: number; // состояние сети на конец этого года
  thisYear: number;
  hidden: ReadonlySet<string>; // выключенные сети
  bakeries: boolean; // показывать пекарни и кафе
  planned: boolean; // показывать анонсированные (только на текущем годе)
  openYears: ReadonlySet<string> | null; // null — все годы открытия
  firstYear: number; // первый год фильтра «Год открытия»
};

/** Точки, видимые при фильтрах. Анонс виден только на текущем годе и при включённом флажке;
 *  пауза считается работающей точкой (как в референсе). */
export function visibleLocations(locs: MarketLocation[], bakery: ReadonlySet<string>, f: MapFilters): MarketLocation[] {
  return locs.filter((l) => {
    if (f.hidden.has(l.chain_key)) return false;
    if (!f.bakeries && bakery.has(l.chain_key)) return false;
    if (f.openYears && !f.openYears.has(openBucket(l, f.firstYear))) return false;
    if (l.status === "planned") return f.planned && f.year === f.thisYear;
    // Пауза — не закрытие: aliveAtYearEnd считает её работающей точкой.
    return aliveAtYearEnd([l], f.year, f.thisYear) === 1;
  });
}

export type CityRow = { city: string; total: number; byChain: Array<[string, number]> };

/** Топ городов по видимым точкам; внутри строки — сети по `rank` (слот, как в эталоне), без
 *  него — по убыванию числа точек. */
export function topCities(locs: Pick<MarketLocation, "city" | "chain_key">[], limit = 10, rank?: (key: string) => number): CityRow[] {
  const by = new Map<string, Map<string, number>>();
  for (const l of locs) {
    if (!l.city) continue;
    const m = by.get(l.city) ?? new Map<string, number>();
    m.set(l.chain_key, (m.get(l.chain_key) ?? 0) + 1);
    by.set(l.city, m);
  }
  return [...by.entries()]
    .map(([city, m]) => ({
      city,
      total: [...m.values()].reduce((a, b) => a + b, 0),
      byChain: [...m.entries()].sort((a, b) => (rank ? rank(a[0]) - rank(b[0]) : 0) || b[1] - a[1]),
    }))
    .sort((a, b) => b.total - a.total || a.city.localeCompare(b.city))
    .slice(0, limit);
}

/** Выбор в фильтре «Год открытия» как в эталоне; null — «все годы». При всех годах клик
 *  оставляет только нажатый, дальше — переключение; пусто или все — снова null. */
export function pickOpenYear(cur: ReadonlySet<string> | null, k: string, all: readonly string[]): Set<string> | null {
  if (!cur) return new Set([k]);
  const next = new Set(cur);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  return next.size && all.some((b) => !next.has(b)) ? next : null;
}

/** Число на чипе сети — работающие и на паузе, без фильтров (как в эталоне). */
export function chainCounts(locs: Pick<MarketLocation, "chain_key" | "status">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of locs) if (l.status === "open" || l.status === "paused") out.set(l.chain_key, (out.get(l.chain_key) ?? 0) + 1);
  return out;
}

export type ViewBox = { x: number; y: number; w: number; h: number };
export const MIN_VB_W = 20;

/** Новый кадр как setVB эталона: ширина в пределах [20; 1,2 страны], высота — по пропорции. */
export function makeVb(x: number, y: number, w: number, W: number, H: number): ViewBox {
  const ww = Math.min(Math.max(w, MIN_VB_W), W * 1.2);
  return { x, y, w: ww, h: (ww * H) / W };
}

/** Кадр, вписывающий прямоугольник (fitBox эталона): добирается до пропорций карты по
 *  меньшей стороне и центрируется. Углы — в любом порядке. */
export function fitBox(x0: number, y0: number, x1: number, y1: number, W: number, H: number): ViewBox {
  const ar = W / H;
  let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (w / h > ar) h = w / ar;
  else w = h * ar;
  return makeVb((x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, W, H);
}

/** Точки в радиусе курсора (подсказка хитмапа): сколько и каких сетей, крупные первыми. */
export function nearByChain(pts: Array<{ x: number; y: number; chain: string }>, mx: number, my: number, radius: number): { n: number; byChain: Array<[string, number]> } {
  const by = new Map<string, number>();
  let n = 0;
  for (const p of pts) {
    if (Math.hypot(p.x - mx, p.y - my) >= radius) continue;
    n++;
    by.set(p.chain, (by.get(p.chain) ?? 0) + 1);
  }
  return { n, byChain: [...by].sort((a, b) => b[1] - a[1]) };
}

