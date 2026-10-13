// Лёгкая выручка Dodo по странам для главной (GET /market/sales?cc=BG,HR,…): только закрытые данные
// mkt_dodo_monthly, без остального набора страны (loadCountry тянет ~10 запросов, 50–190 КБ на страну).
// Чистые функции здесь, чтение базы — loadSales в db.ts. issue #906.

/** Потолок стран в одном запросе: подборка человека — единицы стран, всего рынков в базе ~десяток. */
export const MAX_SALES_COUNTRIES = 30;

/** ?cc=bg,HR,bg → ["BG","HR"]; null — пусто или формат не двухбуквенный (вызывающий отвечает 400). */
export function parseSalesCountries(raw: string | null): string[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[A-Z]{2}$/.test(p))) return null;
  const uniq = [...new Set(parts)];
  return uniq.length > MAX_SALES_COUNTRIES ? null : uniq;
}

/** Поля строки mkt_dodo_monthly, которые читает главная (useCountrySales). */
export type SalesRow = { country: string; month: string; revenue_eur: number | null; complete: boolean };

/** Группировка по странам, от старых месяцев к новым; каждая запрошенная страна присутствует (пусто = []). */
export function groupSales(
  ccs: string[],
  rows: SalesRow[],
): Record<string, Array<{ month: string; revenue_eur: number | null; complete: boolean }>> {
  const out: Record<string, Array<{ month: string; revenue_eur: number | null; complete: boolean }>> = {};
  for (const cc of ccs) out[cc] = [];
  for (const r of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    out[r.country]?.push({ month: r.month, revenue_eur: r.revenue_eur, complete: r.complete });
  }
  return out;
}
