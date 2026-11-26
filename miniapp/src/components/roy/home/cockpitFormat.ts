import { performanceNumber, type MetricValue, type PerformanceMetric } from "@/lib/performance";

export const COCKPIT_METRIC_LABELS: Record<PerformanceMetric, [string, string]> = {
  revenue: ["Выручка без НДС", "Revenue excl. VAT"], orders: ["Заказы", "Orders"],
  delivery_seconds: ["Доставка", "Delivery"], restaurant_cooking_seconds: ["Приготовление в ресторане", "Restaurant cooking"],
  stops_seconds: ["Стопы каналов", "Channel stops"], certificates_count: ["Сертификаты за опоздание", "Late delivery vouchers"],
};
export type CockpitComparison = "mom" | "yoy";
export function cockpitValue(metric: PerformanceMetric, value: MetricValue | undefined, locale: string, compact = false): string {
  const number = performanceNumber(value?.value);
  if (number === null || value?.status === "unavailable") return "—";
  const seconds = metric.endsWith("seconds");
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: seconds ? 1 : 0,
    ...(compact && metric === "revenue" ? { notation: "compact" as const, maximumFractionDigits: 1 } : {}),
  });
  return formatter.format(seconds ? number / 60 : number);
}
export function cockpitUnit(metric: PerformanceMetric, value: MetricValue | undefined, russian: boolean): string {
  if (metric === "revenue") return value?.currency ?? "";
  if (metric === "orders") return russian ? "заказов" : "orders";
  if (metric.endsWith("seconds")) return russian ? "мин" : "min";
  return russian ? "шт." : "vouchers";
}
export function cockpitComparable(metric: PerformanceMetric, current?: MetricValue, previous?: MetricValue): boolean {
  return current?.status === "complete" && previous?.status === "complete"
    && performanceNumber(current.value) !== null && performanceNumber(previous.value) !== null
    && (metric !== "revenue" || (!!current.currency && current.currency === previous.currency));
}
