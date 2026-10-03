// Чистые расчёты экрана «Анализ рынка» (без React — под тестами Deno, marketView.test.ts).
import type { MarketFinancial, MarketPrice, MarketRun, MarketSource } from "../types.ts";
import { aliveAtYearEnd } from "./marketStats";

export type Proj = { K: number; L0: number; LAT0: number; CS: number };
export type MapCity = { name: string; x: number; y: number; capital: boolean; rank: number };
/** Подложка карты (scripts/market/build-shapes.ts): `path` — страна, остальное — контекст. */
export type Shape = {
  path: string;
  proj: Proj;
  W: number;
  H: number;
  land?: string;
  regions?: string;
  lakes?: string;
  rivers?: string;
  cities?: MapCity[];
  areas?: ShapeArea[];
};
/** Укрупнённый регион страны (scripts/market/build-shapes.ts → AREAS). */
export type ShapeArea = { ru: string; en: string; path: string };

/** Кольца из пути SVG вида «M x,y L x,y … Z». */
export function pathRings(path: string): Array<Array<[number, number]>> {
  return path.split("M").filter((s) => s.trim()).map((seg) =>
    seg.replace(/Z/gi, "").split("L").map((p) => p.split(",").map(Number) as [number, number]).filter((p) => p.length === 2 && p.every(Number.isFinite))
  );
}

export type AreaRings = { ru: string; en: string; rings: Array<Array<[number, number]>> };
const NEAR_AREA = 25; // единиц карты: точка на берегу за упрощённым контуром — ещё в регионе

/** Регион точки: внутри контура, иначе ближайший по вершинам в пределах NEAR_AREA. */
export function areaOf(areas: AreaRings[], xy: [number, number]): AreaRings | null {
  const hit = areas.find((a) => insideRings(a.rings, xy));
  if (hit) return hit;
  let best: AreaRings | null = null, d = NEAR_AREA;
  for (const a of areas) {
    for (const r of a.rings) {
      for (const [x, y] of r) {
        const dd = Math.hypot(x - xy[0], y - xy[1]);
        if (dd < d) [d, best] = [dd, a];
      }
    }
  }
  return best;
}

/** Внутри ли точка составного контура (правило чётности: дыра в кольце — снаружи). */
export function insideRings(rings: Array<Array<[number, number]>>, [x, y]: [number, number]): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Та же эквидистантная проекция, что у контуров (public/market/shapes/*.json). */
export const project = (p: Proj, lat: number, lng: number): [number, number] => [
  (lng - p.L0) * p.CS * p.K,
  (p.LAT0 - lat) * p.K,
];


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

type UnitLoc = { opened: string | null; status: string; closed: string | null };
const ymOf = (s: string | null): [number, number | null] | null => {
  const m = s ? /^(\d{4})(?:-(\d{2}))?/.exec(s) : null;
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : null] : null;
};

/** Полных месяцев работы точки в году. Месяц открытия и месяц закрытия не считаются — они
 *  неполные. Известен только год открытия (закрытия) — считается полгода. Без даты
 *  открытия — работала с начала года; закрыта без даты — закрылась в текущем году. */
export function unitMonths(l: UnitLoc, year: number, thisYear = new Date().getFullYear()): number {
  if (l.status === "planned") return 0;
  const o = ymOf(l.opened);
  if (o && o[0] > year) return 0;
  const start = !o || o[0] < year ? 1 : o[1] === null ? 7 : o[1] + 1;
  let end = 12;
  if (l.status === "closed") {
    const c = ymOf(l.closed) ?? [thisYear, null];
    if (c[0] < year) return 0;
    if (c[0] === year) end = c[1] === null ? 6 : c[1] - 1;
  }
  return Math.max(0, end - start + 1);
}

/** Выручка юрлица за год на одну пиццерию: выручка / сумма месяцев работы всех точек × 12
 *  (как в эталоне по Хорватии). Нет выручки или месяцев — null, а не деление на ноль. Если у
 *  большинства точек нет даты открытия (так у всего, что пришло из OSM), сколько точек
 *  работало в том году, неизвестно — тоже null. */
export function revenuePerUnit(fin: Pick<MarketFinancial, "revenue_eur" | "year">, chainLocs: UnitLoc[]): number | null {
  if (fin.revenue_eur === null) return null;
  const units = aliveAtYearEnd(chainLocs, fin.year);
  const undated = aliveAtYearEnd(chainLocs.filter((l) => !l.opened), fin.year);
  const months = chainLocs.reduce((s, l) => s + unitMonths(l, fin.year), 0);
  if (!units || !months || undated * 2 > units) return null;
  return Math.round((fin.revenue_eur / months) * 12);
}

export const STALE_DAYS = 8;
export type Freshness = { adapter: string; feeds: string; mode: string; reason: string | null; lastOk: string | null; daysAgo: number | null; lastError: string | null; bad: boolean };

/** Дата актуальной сборки страны для шапки: последний успешный запуск автоматического источника.
 *  Ручные источники не считаются — их дата говорит о вычитке, а не о сборе. */
export function lastCollected(sources: MarketSource[]): string | null {
  return sources
    .filter((s) => s.mode === "auto" && s.last_ok_at)
    .map((s) => s.last_ok_at as string)
    .sort()
    .at(-1) ?? null;
}

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

export const fmtEur = (v: number | null): string => fmtMoney(v, false);

/** Деньги по языку интерфейса: RU — «€3,7 млн», «€819 тыс.», EN — «€3.7m», «€819k».
 *  От 100 тыс. — в миллионах (так читаются строки отчётности рядом друг с другом). */
export function fmtMoney(v: number | null, ru: boolean): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const n = (x: number, d: number) => (ru ? x.toFixed(d).replace(".", ",") : x.toFixed(d));
  if (a >= 1e9) return ru ? `€${n(v / 1e9, 2)} млрд` : `€${n(v / 1e9, 2)}bn`;
  if (a >= 1e5) return ru ? `€${n(v / 1e6, a >= 1e7 ? 1 : 2)} млн` : `€${n(v / 1e6, a >= 1e7 ? 1 : 2)}m`;
  if (a >= 1e3) return ru ? `€${Math.round(v / 1e3)} тыс.` : `€${Math.round(v / 1e3)}k`;
  return `€${n(v, a < 100 ? 2 : 0)}`;
}
