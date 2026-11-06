// Выручка пиццерий в «Моих странах» (GET /market/sales → unit_sales): чистые помощники, без React и сети.
// Данные — Dodo IS через Децимус; нет данных — null, а не оценка и не подмена соседним числом.
import type { MarketUnitSales } from "./api";

/** код пиццерии (как `id` в /quality, нижний регистр) → выручка с 1-го числа текущего месяца, €; loaded — страна → ISO UTC. */
export type UnitSalesState = { byId: Record<string, number>; loaded: Record<string, string> };

export const NO_UNIT_SALES: UnitSalesState = { byId: {}, loaded: {} };

export function toUnitSales(u: MarketUnitSales | null | undefined): UnitSalesState {
  return u ? { byId: u.units, loaded: u.loaded } : NO_UNIT_SALES;
}

/** Выручка пиццерии, €; null — данных нет (состояние могло быть запомнено прошлой версией без `unitSales`). */
export const unitRevenue = (s: UnitSalesState | undefined, id: string): number | null => s?.byId[id.toLowerCase()] ?? null;

/** «RS 06.11, 10:53, SI 06.11, 10:53» — когда Децимус загрузил продажи стран; пусто — ни одной загрузки. */
export function loadedLabel(loaded: Record<string, string> | undefined, locale: string, timeZone?: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone });
  return Object.entries(loaded ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([cc, at]) => ({ cc, d: new Date(at) })).filter(({ d }) => !Number.isNaN(d.getTime()))
    .map(({ cc, d }) => `${cc} ${fmt.format(d)}`).join("; ");
}
