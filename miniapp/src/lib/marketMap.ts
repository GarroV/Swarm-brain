// Логика карты «Анализа рынка» — по образцу хорватского референса (решение владельца
// 02.10.2026, docs/decisions/2026-10-02-market-follow-reference-visual.md): какие точки видны
// при фильтрах, цвет сети, топ городов. Без React — под тестами.
import type { MarketChain, MarketLocation } from "../types.ts";
import { aliveAtYearEnd } from "./marketStats";

/** Цвет сети — слот 1..8 палитры `--mkt-s*`, 0 — серый «прочие». Крупные международные сети
 *  держат свой цвет во всех странах (McDonald's всегда синий, Dodo — оранжевый), остальным
 *  свободные слоты раздаются по числу точек — сперва обычным сетям, потом пекарням: пекарни по
 *  умолчанию скрыты и не должны отнимать цвет у видимых сетей. */
const KNOWN_SLOT: Record<string, number> = { mcdonalds: 1, dodo: 2, kfc: 3, burgerking: 4, dominos: 5, pizzahut: 6 };
const SLOTS = 8;

export function chainSlots(chains: Pick<MarketChain, "key" | "is_bakery">[], counts: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const c of chains) {
    const s = KNOWN_SLOT[c.key];
    if (s) {
      out.set(c.key, s);
      used.add(s);
    }
  }
  const free = Array.from({ length: SLOTS }, (_, i) => i + 1).filter((s) => !used.has(s));
  const rest = chains.filter((c) => !out.has(c.key)).sort((a, b) => Number(a.is_bakery) - Number(b.is_bakery) || (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
  for (const c of rest) out.set(c.key, free.shift() ?? 0);
  return out;
}

export const slotColor = (slot: number) => `var(--mkt-s${slot})`;

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

/** Топ городов по видимым точкам; внутри строки — сети по убыванию (полоска из отрезков). */
export function topCities(locs: Pick<MarketLocation, "city" | "chain_key">[], limit = 10): CityRow[] {
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
      byChain: [...m.entries()].sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.total - a.total || a.city.localeCompare(b.city))
    .slice(0, limit);
}

/** Цвет каждой сети страны (css-значение): слоты считаются от числа точек в стране. */
export function chainColors(chains: Pick<MarketChain, "key" | "is_bakery">[], locs: Pick<MarketLocation, "chain_key">[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const l of locs) counts.set(l.chain_key, (counts.get(l.chain_key) ?? 0) + 1);
  return new Map([...chainSlots(chains, counts)].map(([k, s]) => [k, slotColor(s)]));
}
