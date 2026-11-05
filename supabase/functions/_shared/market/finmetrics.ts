// Разбор ответа публичного API Dodo FinancialMetrics (https://publicapi.dodois.io/<cc>/api/v1/FinancialMetrics).
// Общий для сборщика (scripts/market, закрытый месяц) и главной (mtd.ts, текущий месяц).

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type FinMetrics = {
  response?: {
    currency?: string;
    previous_month?: { revenue?: number; name?: string; year?: number };
    current_month_progressive_total?: number;
    working_pizzerias?: number;
  };
};

export function parseFinancialMetrics(
  j: FinMetrics,
):
  | {
    month: string;
    amount: number;
    currency: string;
    units: number | null;
    rates?: Record<string, number>;
  }
  | null {
  const pm = j.response?.previous_month;
  const m = MONTHS.indexOf(pm?.name ?? "");
  if (!pm || m < 0 || !pm.year || typeof pm.revenue !== "number") return null;
  return {
    month: `${pm.year}-${String(m + 1).padStart(2, "0")}`,
    amount: pm.revenue,
    currency: j.response?.currency ?? "EUR",
    units: j.response?.working_pizzerias ?? null,
  };
}

export type CurrentMonth = {
  /** валюта ответа */
  currency: string;
  /** выручка с 1-го числа по сегодня включительно, в валюте */
  mtd: number;
  /** прошлый месяц целиком, YYYY-MM и выручка в валюте */
  prevMonth: string;
  prevRevenue: number;
};

/** Текущий месяц из FinancialMetrics; null — в ответе нет чисел или прошлый месяц не разобрать. */
export function parseCurrentMonth(j: FinMetrics): CurrentMonth | null {
  const prev = parseFinancialMetrics(j);
  const r = j.response;
  const mtd = r?.current_month_progressive_total;
  if (!prev || typeof mtd !== "number") return null;
  return {
    currency: prev.currency,
    mtd,
    prevMonth: prev.month,
    prevRevenue: prev.amount,
  };
}
