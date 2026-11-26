"use client";
import { performanceNumber, performancePeriodLabel, type MetricValue, type PerformanceCountry, type PerformanceMetric } from "@/lib/performance";
import { countryName } from "@/lib/countries";
import { useDt } from "../nav";
import { COCKPIT_METRIC_LABELS, cockpitComparable, cockpitUnit, cockpitValue, type CockpitComparison } from "./cockpitFormat";
import { CockpitDelta, CockpitMetricStatus, CockpitValue } from "./CockpitMetric";
import styles from "./cockpit.module.css";

type Props = { code: string; country?: PerformanceCountry; metric: PerformanceMetric; comparison: CockpitComparison; onRevenue: () => void; loading: boolean };
function PeriodBars({ country, metric, comparison }: Pick<Props, "country" | "metric" | "comparison">) {
  const dt = useDt(), locale = dt("ru-RU", "en-GB");
  const pair = country?.metrics[metric], current = pair?.current, previous = pair?.[comparison];
  const currentNumber = current?.status === "unavailable" ? null : performanceNumber(current?.value);
  const sameCurrency = metric !== "revenue" || (!!current?.currency && current.currency === previous?.currency);
  const comparable = cockpitComparable(metric, current, previous);
  const previousNumber = comparable ? performanceNumber(previous?.value) : null;
  const max = Math.max(currentNumber ?? 0, previousNumber ?? 0);
  const bars: Array<{ label: string; value?: MetricValue; number: number | null; previous: boolean }> = [
    { label: country ? performancePeriodLabel(country.periods.current) : dt("Текущий период", "Current period"), value: current, number: currentNumber, previous: false },
    { label: country ? performancePeriodLabel(country.periods[comparison]) : dt("Предыдущий период", "Previous period"), value: previous, number: previousNumber, previous: true },
  ];
  return <div className={styles.periodBars} role="img" aria-label={dt("Итоги за указанные периоды", "Values for the stated periods")}>
    <div className={styles.graphLabel}>{dt(metric.endsWith("seconds") && metric !== "stops_seconds" ? "Среднее за период" : "Итоги за периоды", metric.endsWith("seconds") && metric !== "stops_seconds" ? "Period average" : "Period totals")}</div>
    {bars.map((bar, index) => <div key={index} className={styles.periodBarRow}>
      <div className={styles.barLabel}><span>{bar.label}{bar.value?.status === "partial" ? dt(" · часть данных", " · partial data") : ""}{bar.value?.stale ? dt(" · устарело", " · outdated") : ""}</span><strong>{bar.number === null ? "—" : `${cockpitValue(metric, bar.value, locale, true)} ${cockpitUnit(metric, bar.value, dt("ru", "en") === "ru")}`}</strong></div>
      <div className={styles.barTrack}>{bar.number !== null && <span className={`${styles.barFill} ${bar.previous ? styles.previousBar : ""}`} style={{ width: `${max > 0 ? Math.max(0, bar.number / max * 100) : 0}%` }} />}</div>
    </div>)}
    <p>{currentNumber === null ? dt("Нет подтверждённых данных для графика", "No confirmed data for this chart") : !sameCurrency ? dt("Прошлый период в другой валюте не сравниваем", "Previous period uses a different currency") : !comparable ? dt("Нет полного сравнения за эти периоды", "Complete comparison unavailable for these periods") : dt("Сравнение итогов, без накопительного ряда", "Comparison of period values, not a cumulative series")}</p>
  </div>;
}

export function CockpitHero({ code, country, metric, comparison, onRevenue, loading }: Props) {
  const dt = useDt(), row = country?.metrics[metric];
  return <section className={styles.hero} id="home-cockpit-metric" aria-busy={loading}>
    <div className={styles.heroHeading}>
      <div><span className={styles.eyebrow}>{code} · {dt("Показатели страны", "Country performance")}</span><h2>{dt(countryName(code), country?.name ?? code)}</h2></div>
      <button type="button" onClick={onRevenue} aria-pressed={metric === "revenue"} className={styles.button}>{dt("Выручка", "Revenue")} →</button>
    </div>
    <div className={styles.heroBody}>
      <div className={styles.heroSummary}>
        <h3>{dt(...COCKPIT_METRIC_LABELS[metric])}</h3>
        <p className={styles.heroDates}>{country ? performancePeriodLabel(country.periods.current) : dt("Период не получен", "Period unavailable")}</p>
        <div className={styles.heroNumber}>{loading ? <span className="roy-shim inline-block h-10 w-36 rounded-lg" /> : <CockpitValue metric={metric} value={row?.current} />}</div>
        <div className={styles.heroChange}>{!loading && <CockpitDelta metric={metric} current={row?.current} previous={row?.[comparison]} full />}</div>
        {!loading && <CockpitMetricStatus value={row?.current} />}
      </div>
      <PeriodBars country={loading ? undefined : country} metric={metric} comparison={comparison} />
    </div>
    <p className={styles.source}>{dt("Decimus · закрытые дни · валюты разных стран не суммируются", "Decimus · completed days · country currencies are not combined")}{country && ` · ${country.timezone}`}</p>
  </section>;
}
