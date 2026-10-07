"use client";
import { useEffect, useState } from "react";
import { fetchMarket } from "@/lib/api";

// Выручка Dodo по странам подборки — НАСТОЯЩИЕ данные «Анализа рынка» (публичный API Dodo,
// GET /market/:cc). Берём только закрытые месяцы: текущий неполный исказил бы сравнение.

export type CountrySales = {
  cc: string;
  /** закрытые месяцы, от старых к новым: [YYYY-MM, выручка в евро] */
  months: Array<[string, number]>;
  last: number | null;
  /** изменение последнего закрытого месяца к предыдущему, % */
  deltaPct: number | null;
};

export type SalesState = { byCc: Record<string, CountrySales>; loading: boolean; failed: string[] };

export function useCountrySales(codes: string[]): SalesState {
  const key = [...codes].sort().join(",");
  const [state, setState] = useState<SalesState>({ byCc: {}, loading: true, failed: [] });

  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    setState((s) => ({ ...s, loading: true }));
    Promise.allSettled(list.map((cc) => fetchMarket(cc).then((b) => toSales(cc, b.dodo ?? []))))
      .then((res) => {
        if (!alive) return;
        const byCc: Record<string, CountrySales> = {};
        const failed: string[] = [];
        res.forEach((r, i) => {
          if (r.status === "fulfilled") byCc[list[i]] = r.value;
          else { failed.push(list[i]); console.warn("[home] sales", list[i], r.reason); }
        });
        setState({ byCc, loading: false, failed });
      });
    return () => { alive = false; };
  }, [key]);

  return state;
}

function toSales(cc: string, dodo: Array<{ month: string; revenue_eur: number | null; complete: boolean }>): CountrySales {
  const months = dodo
    .filter((m) => m.complete && m.revenue_eur != null)
    .map((m) => [m.month.slice(0, 7), m.revenue_eur as number] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const last = months.at(-1)?.[1] ?? null;
  const prev = months.at(-2)?.[1] ?? null;
  return { cc, months, last, deltaPct: last != null && prev ? ((last - prev) / prev) * 100 : null };
}
