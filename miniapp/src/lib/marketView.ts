// Чистые расчёты экрана «Анализ рынка» (без React — под тестами Deno, marketView.test.ts).
import type { MarketFinancial, MarketPrice, MarketRun, MarketSource } from "../types.ts";
import { aliveAtYearEnd } from "./marketStats";

export type Proj = { K: number; L0: number; LAT0: number; CS: number };
export type Shape = { path: string; proj: Proj; W: number; H: number };

/** Та же эквидистантная проекция, что у контуров (public/market/shapes/*.json). */
export const project = (p: Proj, lat: number, lng: number): [number, number] => [
  (lng - p.L0) * p.CS * p.K,
  (p.LAT0 - lat) * p.K,
];

/** Цвет — по сегменту, а не по сети: сетей в стране до двух десятков, а различимых цветов
 *  графика пять. Сегмент на карте читается сразу («где пицца, где бургеры»), сеть — фильтром. */
const SEGMENT_COLOR: Record<string, number> = { pizza: 1, burger: 4, chicken: 5, bakery: 3 };
export const segmentColor = (segment: string): string => `var(--chart-${SEGMENT_COLOR[segment] ?? 2})`;

/** Медиана цены пиццы ~30 см (28–32 см) по сети: так сравнимы сети с разной линейкой размеров. */
export function medianPizza30(prices: MarketPrice[], chain: string): number | null {
  const v = prices
    .filter((p) => p.chain_key === chain && p.size_cm !== null && p.size_cm >= 28 && p.size_cm <= 32)
    .map((p) => p.price_eur)
    .sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 100) / 100;
}

/** Выручка юрлица за год на одну работавшую к концу года точку его сети. Нет выручки или
 *  точек — null, а не деление на ноль. Если у большинства точек нет даты открытия (так у
 *  всего, что пришло из OSM), число точек того года неизвестно — тоже null. */
export function revenuePerUnit(
  fin: Pick<MarketFinancial, "revenue_eur" | "year">,
  chainLocs: Array<{ opened: string | null; status: string; closed: string | null }>,
): number | null {
  if (fin.revenue_eur === null) return null;
  const units = aliveAtYearEnd(chainLocs, fin.year);
  const undated = aliveAtYearEnd(chainLocs.filter((l) => !l.opened), fin.year);
  if (!units || undated * 2 > units) return null;
  return Math.round(fin.revenue_eur / units);
}

export const STALE_DAYS = 8;
export type Freshness = { adapter: string; feeds: string; mode: string; reason: string | null; lastOk: string | null; daysAgo: number | null; lastError: string | null; bad: boolean };

/** Свежесть каждого источника: последний успешный запуск и последняя ошибка, если она позже.
 *  Плохо — авто-источник, который упал последним прогоном или молчит дольше недели с запасом. */
export function freshness(sources: MarketSource[], runs: MarketRun[], now: Date): Freshness[] {
  return sources.map((s) => {
    const last = runs.filter((r) => r.source === s.adapter).sort((a, b) => b.finished_at.localeCompare(a.finished_at))[0];
    const daysAgo = s.last_ok_at ? Math.floor((now.getTime() - Date.parse(s.last_ok_at)) / 86_400_000) : null;
    const failedLast = last?.status === "failed";
    const auto = s.mode === "auto";
    return {
      adapter: s.adapter,
      feeds: s.feeds,
      mode: s.mode,
      reason: s.reason,
      lastOk: s.last_ok_at,
      daysAgo,
      lastError: failedLast ? last.error : null,
      bad: auto && (failedLast || daysAgo === null || daysAgo > STALE_DAYS),
    };
  });
}

/** Каналы заказов Dodo за месяц без служебного _days. */
export function orderChannels(orders: Record<string, unknown> | null): Record<string, number> {
  if (!orders) return {};
  return Object.fromEntries(
    Object.entries(orders).filter(([k, v]) => !k.startsWith("_") && typeof v === "number") as Array<[string, number]>,
  );
}

/** Сетка плотности: число точек в ячейке n×n поверх контура. */
export function densityGrid(points: Array<[number, number]>, W: number, H: number, n: number): number[][] {
  const g = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const [x, y] of points) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((y / H) * n)));
    const j = Math.min(n - 1, Math.max(0, Math.floor((x / W) * n)));
    g[i][j]++;
  }
  return g;
}

export const fmtEur = (v: number | null): string => {
  if (v === null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `€${(v / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `€${Math.round(v / 1e3)}k`;
  return `€${Math.round(v)}`;
};
