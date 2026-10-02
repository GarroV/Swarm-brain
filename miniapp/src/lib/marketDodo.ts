// Расчёты куска Dodo в секции пиццы по образцу эталона: суммы операций по месяцам и по
// пиццериям (ручная часть dodo_ops), шкалы графиков и месяц запуска второй пиццерии.
import type { EdDodoOps } from "./marketEditorial.ts";

export const OPS_KEYS = ["rev", "agg", "din", "own", "o", "oagg", "odin", "oown"] as const;
export type OpsKey = (typeof OPS_KEYS)[number];
export type OpsSum = Record<OpsKey, number>;

/** Сумма полей операций по набору строк — как sum() эталона. */
export function opsSum(rows: EdDodoOps[]): OpsSum {
  return Object.fromEntries(OPS_KEYS.map((k) => [k, rows.reduce((a, r) => a + (r[k] || 0), 0)])) as OpsSum;
}

/** Месяцы по порядку и сумма обеих (всех) пиццерий за каждый. */
export function opsByMonth(rows: EdDodoOps[]): Array<OpsSum & { m: number }> {
  const months = [...new Set(rows.map((r) => r.m))].sort((a, b) => a - b);
  return months.map((m) => ({ m, ...opsSum(rows.filter((r) => r.m === m)) }));
}

/** Пиццерии в порядке названия и итог по стране последним столбцом. */
export function opsByUnit(rows: EdDodoOps[]): Array<OpsSum & { u: string | null }> {
  const units = [...new Set(rows.map((r) => r.u))].sort((a, b) => a.localeCompare(b));
  return [...units.map((u) => ({ u: u as string | null, ...opsSum(rows.filter((r) => r.u === u)) })), { u: null, ...opsSum(rows) }];
}

/** Верх шкалы: как в эталоне (base), а если данные выше — до ближайшего кратного шага. */
export function scaleTop(max: number, step: number, base: number): number {
  return Math.max(base, Math.ceil(max / step) * step);
}

/** Низ шкалы среднего чека: как в эталоне, а если данные ниже — до кратного шага вниз (не ниже 0). */
export function scaleBottom(min: number, step: number, base: number): number {
  return Math.max(0, Math.min(base, Math.floor(min / step) * step));
}

/** Деления шкалы от lo до hi с шагом step. */
export function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/** Индекс первого месяца, где пиццерий стало больше, чем в предыдущем, — пунктир запуска
 *  второй точки. Нет роста — null. */
export function unitGrowthIndex(units: Array<number | null>): number | null {
  for (let i = 1; i < units.length; i++) {
    const a = units[i - 1], b = units[i];
    if (a !== null && b !== null && a > 0 && b > a) return i;
  }
  return null;
}

/** Деньги эталона в таблице пицц: от миллиона — «€4,09 млн», меньше — «€813 тыс.». */
export function fmtK(v: number | null, ru: boolean): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v / 1e6 >= 1) return ru ? `€${(v / 1e6).toFixed(2).replace(".", ",")} млн` : `€${(v / 1e6).toFixed(2)}m`;
  return ru ? `€${Math.round(v / 1e3)} тыс.` : `€${Math.round(v / 1e3)}k`;
}
