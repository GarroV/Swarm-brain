import type { PerformanceMetric, PerformancePeriod } from "./performance";

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
