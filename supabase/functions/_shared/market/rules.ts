// Правила сборщиков «Анализа рынка» (спека §«Правила сборщиков») — чистые функции под тестами.
import { TRUSTED, type Verification } from "./types.ts";

export const CLOSE_AFTER_WEEKS = 3;
/** Выдуманная страна демо (диапазон XA–XZ в ISO 3166 — пользовательские коды). */
export const DEMO_COUNTRY = "XD";

/** «Возможно закрыта» — только у точки, которую в базу привёл сам OSM и которую никто не
 *  подтвердил. Проверенную запись отсутствие в OSM не трогает никогда: OSM видит не всё
 *  (сверка по Хорватии 02.10.2026 — локальных сетей в нём нет вовсе). */
export function shouldFlagClosed(
  loc: { verification: Verification; source_kind: string | null; missing_weeks: number },
): boolean {
  return loc.source_kind === "osm" && !TRUSTED.includes(loc.verification) && loc.missing_weeks >= CLOSE_AFTER_WEEKS;
}

export type DayOrders = { date: string; counts: Record<string, number> };
export type MonthOrders = { month: string; orders: Record<string, number>; complete: boolean };

/** Дневные заказы → месяцы; месяц `today` и позже помечается неполным. */
export function foldDailyOrders(days: DayOrders[], today: string): MonthOrders[] {
  const by = new Map<string, Record<string, number>>();
  for (const d of days) {
    const month = d.date.slice(0, 7);
    const acc = { ...(by.get(month) ?? {}) };
    for (const [k, v] of Object.entries(d.counts)) if (v) acc[k] = (acc[k] ?? 0) + v;
    by.set(month, acc);
  }
  const current = today.slice(0, 7);
  return [...by.keys()].sort().map((month) => ({ month, orders: by.get(month)!, complete: month < current }));
}

/** `rates` — единиц валюты за 1 EUR (как в курсах ЕЦБ). */
export function toEur(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "EUR") return amount;
  const r = rates[currency];
  return r ? Math.round((amount / r) * 100) / 100 : null;
}

/** Данные рынка — страны, а не воркспейса: видно то, что есть в allowed_markets.
 *  Демо видит только выдуманную XD, настоящие воркспейсы её не видят никогда. */
export function canSeeCountry(cc: string, allowed: string[] | null, isDemo: boolean): boolean {
  const c = cc.toUpperCase();
  if (isDemo) return c === DEMO_COUNTRY;
  return c !== DEMO_COUNTRY && (allowed ?? []).map((a) => a.toUpperCase()).includes(c);
}
