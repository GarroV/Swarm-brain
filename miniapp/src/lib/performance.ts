import { mcpApiFetch } from "./api";

export const PERFORMANCE_METRICS = ["revenue", "orders", "delivery_seconds", "restaurant_cooking_seconds", "stops_seconds", "certificates_count"] as const;
export type PerformanceMetric = typeof PERFORMANCE_METRICS[number];
export type MetricValue = {
  value: string | null; status: "complete" | "partial" | "unavailable";
  currency?: string | null; stale: boolean | null; loaded_at: string | null;
  reason?: string | null; source?: string; aggregation?: string;
  coverage: { covered_units?: number | null; expected_units?: number | null; scope?: "source_country" } | null;
  delta?: string | null; delta_pct?: string | null; comparison_status?: string;
};
export type PerformanceValues = Record<PerformanceMetric, { unit: string; current: MetricValue; mom: MetricValue; yoy: MetricValue }>;
export type PerformanceUnit = { dodo_id: string; name: string; metrics: PerformanceValues; lfl: unknown[] };
export type PerformancePeriod = { from: string; to: string };
export type PerformanceCountry = {
  cc: string; name: string; as_of: string; timezone: string; timezone_fallback: boolean;
  periods: Record<"current" | "mom" | "yoy", PerformancePeriod>;
  metrics: PerformanceValues; units: PerformanceUnit[]; lfl: unknown[];
};
export type PerformanceData = { as_of: string | null; countries: PerformanceCountry[] };

export function fetchPerformance(countries: string[], asOf?: string): Promise<PerformanceData> {
  const params = new URLSearchParams({ countries: [...new Set(countries)].sort().join(",") });
  if (asOf) params.set("as_of", asOf);
  return mcpApiFetch(`/performance?${params}`);
}

export function performanceDirection(metric: PerformanceMetric, delta: string | null | undefined): "good" | "bad" | "neutral" {
  if (delta == null || delta.trim() === "") return "neutral";
  const number = Number(delta);
  if (!Number.isFinite(number) || number === 0) return "neutral";
  const lowerBetter = metric !== "revenue" && metric !== "orders";
  return (number < 0) === lowerBetter ? "good" : "bad";
}

export function performanceNumber(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Calendar dates from the source; no browser timezone conversion or reporting jargon. */
export function performancePeriodLabel(period: PerformancePeriod): string {
  const valid = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const stamp = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === day;
  };
  if (!valid(period.from) || !valid(period.to) || period.from > period.to) return "—";
  const [fy, fm, fd] = period.from.split("-");
  const [ty, tm, td] = period.to.split("-");
  if (period.from === period.to) return `${fd}.${fm}.${fy}`;
  if (fy === ty && fm === tm) return `${fd}–${td}.${tm}.${ty}`;
  if (fy === ty) return `${fd}.${fm}–${td}.${tm}.${ty}`;
  return `${fd}.${fm}.${fy}–${td}.${tm}.${ty}`;
}
