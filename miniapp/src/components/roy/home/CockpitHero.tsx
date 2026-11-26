"use client";
import { performancePeriodLabel, type PerformanceCountry, type PerformanceMetric } from "@/lib/performance";
import { countryName } from "@/lib/countries";
import { useDt } from "../nav";
import { COCKPIT_METRIC_LABELS, cockpitUnit, type CockpitComparison } from "./cockpitFormat";
import { CockpitDelta, CockpitMetricStatus, CockpitValue } from "./CockpitMetric";
import { CockpitChart } from "./CockpitChart";
import styles from "./cockpit.module.css";

type Props = { code: string; country?: PerformanceCountry; metric: PerformanceMetric; comparison: CockpitComparison; onRevenue: () => void; loading: boolean };

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
      <CockpitChart current={loading ? [] : country?.daily?.current ?? []} previous={loading ? [] : country?.daily?.[comparison] ?? []} metric={metric}
        label={dt("По дням", "Daily values")} partialLabel={dt("Часть данных", "Partial data")} staleLabel={dt("Данные давно не обновлялись", "Data is outdated")} locale={dt("ru-RU", "en-GB")} unit={cockpitUnit(metric, row?.current, dt("ru", "en") === "ru")} currency={row?.current?.currency}
        currentLabel={country ? performancePeriodLabel(country.periods.current) : ""} previousLabel={country ? performancePeriodLabel(country.periods[comparison]) : ""}
        empty={dt("Дневные данные ещё не загружены", "Daily data has not loaded yet")} />
    </div>
    <p className={styles.source}>{dt("Dodo IS · завершённые дни", "Dodo IS · completed days")}{country && ` · ${country.timezone}`}</p>
  </section>;
}
