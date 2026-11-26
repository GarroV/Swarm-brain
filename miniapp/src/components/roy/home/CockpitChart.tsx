"use client";
import { performanceNumber, type PerformanceDay, type PerformanceMetric } from "@/lib/performance";
import styles from "./cockpit.module.css";

type Props = { current: PerformanceDay[]; previous: PerformanceDay[]; metric: PerformanceMetric;
  label: string; partialLabel: string; staleLabel: string; currentLabel: string; previousLabel: string; empty: string; locale: string; unit: string; currency?: string | null };
export function CockpitChart({ current, previous, metric, label, partialLabel, staleLabel, currentLabel, previousLabel, empty, locale, unit, currency }: Props) {
  const value = (day: PerformanceDay) => {
    const point = day.metrics[metric];
    if (!point || point.status === "unavailable" || metric === "revenue" && point.currency !== currency) return null;
    const n = performanceNumber(point.value);
    return n === null ? null : metric.endsWith("seconds") ? n / 60 : n;
  };
  const numbers = [...current, ...previous].map(value).filter((n): n is number => n !== null);
  const max = Math.max(...numbers, 1), min = Math.min(...numbers, 0);
  const count = Math.max(current.length, previous.length, 2);
  const x = (i: number) => 12 + i * 564 / (count - 1);
  const y = (n: number) => 130 - (n - min) / (max - min) * 116;
  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: metric.endsWith("seconds") ? 1 : 0 }).format(n);
  const path = (rows: PerformanceDay[]) => {
    let started = false;
    return rows.map((day, i) => { const n = value(day); if (n === null) { started = false; return ""; }
      const command = started ? "L" : "M"; started = true; return `${command}${x(i)},${y(n)}`;
    }).join(" ");
  };
  const hasCurrent = current.some(day => value(day) !== null), hasPrevious = previous.some(day => value(day) !== null);
  return <div className={styles.dailyChart} data-chart-kind="daily" data-chart-metric={metric}>
    <div className={styles.graphLabel}><span>{label}</span><span>{unit}</span></div>
    {!hasCurrent ? <div className={styles.chartEmpty}>{empty}</div> : <>
      <svg viewBox="0 0 600 150" className={styles.chartSvg} role="img" aria-label={label}>
        {[14, 72, 130].map(h => <path key={h} d={`M12 ${h} H576`} className={styles.chartGrid} />)}
        {hasPrevious && <path d={path(previous)} className={styles.chartPrevious} />}
        <path d={path(current)} className={styles.chartCurrent} />
        {current.map((day, i) => { const n = value(day); const title = n === null ? "" : [day.date, fmt(n), unit, day.metrics[metric]?.status === "partial" ? partialLabel : ""].join(" "); return n === null ? null : <circle key={day.date} cx={x(i)} cy={y(n)} r="2.5" className={styles.chartPoint}><title>{title}</title></circle>; })}
      </svg>
      <div className={styles.chartAxis}>{[0, Math.floor((count - 1) / 2), count - 1].map(i => <span key={i}>{current[i]?.date.slice(8) ?? i + 1}</span>)}</div>
    </>}
    {current.some(day => day.metrics[metric]?.stale) && <p className={styles.chartPartial}>{staleLabel}</p>}
    {[...current, ...previous].some(day => day.metrics[metric]?.status === "partial") && <p className={styles.chartPartial}>{partialLabel}</p>}
    <div className={styles.chartLegend}><span><i />{currentLabel}</span>{hasPrevious && <span><i className={styles.previousLegend} />{previousLabel}</span>}</div>
  </div>;
}
