"use client";
import { useEffect, useState } from "react";
import { ApiError, fetchMarket, fetchMarketSales, type MarketSalesRow } from "@/lib/api";

// Выручка Dodo по странам подборки — НАСТОЯЩИЕ данные «Анализа рынка» (публичный API Dodo,
// GET /market/sales — одним запросом на все страны, issue #906). Берём только закрытые месяцы: текущий неполный исказил бы сравнение.

export type CountrySales = {
  cc: string;
  /** закрытые месяцы, от старых к новым: [YYYY-MM, выручка в евро] */
  months: Array<[string, number]>;
  last: number | null;
  /** изменение последнего закрытого месяца к предыдущему, % */
  deltaPct: number | null;
};

/** €125к / €1.25м — короткая запись выручки. */
export const fmtEur = (v: number): string => (v >= 1e6 ? `€${(v / 1e6).toFixed(2)}м` : `€${(v / 1e3).toFixed(0)}к`);

export type SalesState = { byCc: Record<string, CountrySales>; loading: boolean; failed: string[] };

export function useCountrySales(codes: string[]): SalesState {
  const key = [...codes].sort().join(",");
  const [state, setState] = useState<SalesState>({ byCc: {}, loading: true, failed: [] });

  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    setState((s) => ({ ...s, loading: true }));
    loadSales(list)
      .then(({ sales, failed }) => {
        if (!alive) return;
        const byCc: Record<string, CountrySales> = {};
        for (const [cc, rows] of Object.entries(sales)) byCc[cc] = toSales(cc, rows);
        setState({ byCc, loading: false, failed });
      });
    return () => { alive = false; };
  }, [key]);

  return state;
}

/**
 * Один запрос /market/sales. Если сервер его ещё не знает (404 — веб раскатан раньше функций, например на
 * превью ветки против прода), откатываемся на прежний путь: полный набор по каждой стране. Порядок раскатки
 * поэтому неважен; убрать откат можно, когда /market/sales в проде.
 */
async function loadSales(list: string[]): Promise<{ sales: Record<string, MarketSalesRow[]>; failed: string[] }> {
  if (!list.length) return { sales: {}, failed: [] };
  try {
    const r = await fetchMarketSales(list);
    return { sales: r.sales, failed: r.denied };
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) {
      console.warn("[home] sales", e);
      return { sales: {}, failed: list };
    }
  }
  const res = await Promise.allSettled(list.map((cc) => fetchMarket(cc).then((b) => b.dodo ?? [])));
  const sales: Record<string, MarketSalesRow[]> = {};
  const failed: string[] = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") sales[list[i]] = r.value;
    else { failed.push(list[i]); console.warn("[home] sales", list[i], r.reason); }
  });
  return { sales, failed };
}

function toSales(cc: string, dodo: MarketSalesRow[]): CountrySales {
  const months = dodo
    .filter((m) => m.complete && m.revenue_eur != null)
    .map((m) => [m.month.slice(0, 7), m.revenue_eur as number] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const last = months.at(-1)?.[1] ?? null;
  const prev = months.at(-2)?.[1] ?? null;
  return { cc, months, last, deltaPct: last != null && prev ? ((last - prev) / prev) * 100 : null };
}
