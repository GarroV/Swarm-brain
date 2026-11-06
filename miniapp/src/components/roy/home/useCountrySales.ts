"use client";
import { useEffect, useState } from "react";
import { ApiError, fetchMarket, fetchMarketSales, type MarketMtd, type MarketSalesRow } from "@/lib/api";
import { recall, remember } from "@/lib/lastSeen";
import { NO_UNIT_SALES, toUnitSales, type UnitSalesState } from "@/lib/homeSales";

// Выручка Dodo по странам подборки — НАСТОЯЩИЕ данные «Анализа рынка» (публичный API Dodo,
// GET /market/sales — одним запросом на все страны, issue #906). Берём только закрытые месяцы: текущий неполный исказил бы сравнение.

export type CountrySales = {
  cc: string;
  /** закрытые месяцы, от старых к новым: [YYYY-MM, выручка в евро] */
  months: Array<[string, number]>;
  last: number | null;
  /** изменение последнего закрытого месяца к предыдущему, % */
  deltaPct: number | null;
  /** выручка с 1-го числа по сегодня (виджет «Мои страны»); null — сервер не смог посчитать: в таблице «—», не подмена закрытым месяцем */
  mtd: MarketMtd | null;
};

/** €125к / €1.25м — короткая запись выручки; до 10 тыс. — с десятой (пиццерии: €4.1к, а не «€4к»), до тысячи — целые евро. */
export const fmtEur = (v: number): string => {
  if (v >= 1e6) return `€${(v / 1e6).toFixed(2)}м`;
  if (v >= 1e4) return `€${(v / 1e3).toFixed(0)}к`;
  return v >= 1e3 ? `€${(v / 1e3).toFixed(1)}к` : `€${Math.round(v)}`;
};

export type SalesState = {
  byCc: Record<string, CountrySales>; loading: boolean; failed: string[];
  /** может отсутствовать в состоянии, запомненном прошлой версией */
  unitSales?: UnitSalesState;
};

export function useCountrySales(codes: string[]): SalesState {
  const key = [...codes].sort().join(",");
  // Повторный заход — сразу с прошлой выручкой по этой подборке, обновление в фоне (#906).
  const memo = `home:sales:${key}`;
  const [state, setState] = useState<SalesState>(() => recall<SalesState>(memo) ?? { byCc: {}, loading: true, failed: [] });

  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    setState(recall<SalesState>(memo) ?? { byCc: {}, loading: true, failed: [] });
    loadSales(list)
      .then(({ sales, mtd, failed, unitSales }) => {
        if (!alive) return;
        const byCc: Record<string, CountrySales> = {};
        for (const [cc, rows] of Object.entries(sales)) byCc[cc] = toSales(cc, rows, mtd[cc] ?? null);
        setState(remember(memo, { byCc, loading: false, failed, unitSales }));
      });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

/**
 * Один запрос /market/sales. Если сервер его ещё не знает (404 — веб раскатан раньше функций, например на
 * превью ветки против прода), откатываемся на прежний путь: полный набор по каждой стране. Порядок раскатки
 * поэтому неважен; убрать откат можно, когда /market/sales в проде.
 */
async function loadSales(list: string[]): Promise<{ sales: Record<string, MarketSalesRow[]>; mtd: Record<string, MarketMtd | null>; failed: string[]; unitSales: UnitSalesState }> {
  if (!list.length) return { sales: {}, mtd: {}, failed: [], unitSales: NO_UNIT_SALES };
  try {
    const r = await fetchMarketSales(list);
    return { sales: r.sales, mtd: r.mtd ?? {}, failed: r.denied, unitSales: toUnitSales(r.unit_sales) };
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) {
      console.warn("[home] sales", e);
      return { sales: {}, mtd: {}, failed: list, unitSales: NO_UNIT_SALES };
    }
  }
  const res = await Promise.allSettled(list.map((cc) => fetchMarket(cc).then((b) => b.dodo ?? [])));
  const sales: Record<string, MarketSalesRow[]> = {};
  const failed: string[] = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") sales[list[i]] = r.value;
    else { failed.push(list[i]); console.warn("[home] sales", list[i], r.reason); }
  });
  return { sales, mtd: {}, failed, unitSales: NO_UNIT_SALES };
}

function toSales(cc: string, dodo: MarketSalesRow[], mtd: MarketMtd | null): CountrySales {
  const months = dodo
    .filter((m) => m.complete && m.revenue_eur != null)
    .map((m) => [m.month.slice(0, 7), m.revenue_eur as number] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const last = months.at(-1)?.[1] ?? null;
  const prev = months.at(-2)?.[1] ?? null;
  return { cc, months, last, deltaPct: last != null && prev ? ((last - prev) / prev) * 100 : null, mtd };
}
