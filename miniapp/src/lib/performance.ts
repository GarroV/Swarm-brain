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

export { performanceDirection, performanceNumber, performancePeriodLabel } from "./performance-format";
