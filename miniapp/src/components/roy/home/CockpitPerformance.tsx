"use client";
import { useEffect, useState, type ReactNode } from "react";
import { countryName } from "@/lib/countries";
import { fetchPerformance, PERFORMANCE_METRICS, performancePeriodLabel, type PerformanceCountry, type PerformanceData, type PerformanceMetric } from "@/lib/performance";
import { useDt } from "../nav";
import { CockpitHero } from "./CockpitHero";
import { CockpitDelta, CockpitMetricStatus, CockpitValue } from "./CockpitMetric";
import { CockpitUnits } from "./CockpitUnits";
import { COCKPIT_METRIC_LABELS, type CockpitComparison } from "./cockpitFormat";
import styles from "./cockpit.module.css";

type Props = {
  codes: string[]; selected: string; onSelect: (code: string) => void;
  showUnits: boolean; children?: ReactNode;
};
type Resource = { key: string; data: PerformanceData | null; failed: boolean };
const previousDayMonth = () => {
  const day = new Date(); day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}`;
};

export function CockpitPerformance({ codes, selected, onSelect, showUnits, children }: Props) {
  const dt = useDt();
  const [comparison, setComparison] = useState<CockpitComparison>("mom");
  const [metric, setMetric] = useState<PerformanceMetric>("revenue");
  const [month, setMonth] = useState(previousDayMonth);
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<Resource>({ key: "", data: null, failed: false });
  const countriesKey = [...new Set(codes)].sort().join(","), key = `${countriesKey}|${month}|${attempt}`;
  useEffect(() => {
    if (!countriesKey) return;
    let alive = true;
    const [year, number] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    const currentMonth = new Date().toISOString().slice(0, 7);
    fetchPerformance(countriesKey.split(","), month === currentMonth ? undefined : last).then(
      (data) => { if (alive) setResource({ key, data, failed: false }); },
      () => { if (alive) setResource({ key, data: null, failed: true }); },
    );
    return () => { alive = false; };
  }, [countriesKey, month, key]);
  const loading = !!countriesKey && resource.key !== key;
  const countries = loading ? [] : resource.data?.countries ?? [];
  const country: PerformanceCountry | undefined = countries.find((row) => row.cc === selected);
  return <div className={styles.performance}>
    <div className={styles.sectionHeading}><div><h2>{dt("Страны под управлением", "Your countries")}</h2><p>{dt("Показатели за завершённые дни", "Performance through completed days")}</p></div><label className={styles.monthControl}>{dt("Месяц", "Month")}<input type="month" value={month} max={previousDayMonth()} aria-label={dt("Месяц показателей", "Performance month")} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value <= previousDayMonth()) setMonth(event.target.value); }} /></label></div>
    <div className={styles.comparisonControls}>
      <div className={styles.periodCaption}>{country ? <><strong>{performancePeriodLabel(country.periods.current)}</strong><span>{dt("сравнение с", "compared with")} {performancePeriodLabel(country.periods[comparison])}</span></> : <span>{loading ? dt("Получаем периоды…", "Loading periods…") : dt("Период источника недоступен", "Source period unavailable")}</span>}</div>
      <div className={styles.comparisonButtons} role="group" aria-label={dt("С чем сравнить", "Compare against")}>
        {(["mom", "yoy"] as const).map((mode) => <button key={mode} type="button" onClick={() => setComparison(mode)} aria-pressed={comparison === mode}>{mode === "mom" ? dt("Прошлый месяц", "Previous month") : dt("Прошлый год", "Previous year")}</button>)}
      </div>
    </div>
    {resource.key === key && resource.failed && <p role="alert" className={styles.fetchError}>{dt("Не удалось получить показатели стран.", "Couldn't load country performance.")} <button type="button" onClick={() => setAttempt((before) => before + 1)} className={styles.textButton}>{dt("Повторить", "Retry")}</button></p>}
    <div className={styles.countryGrid} style={{ gridTemplateColumns: `repeat(${Math.min(codes.length || 1, 4)}, minmax(0, 1fr))` }} role="group" aria-label={dt("Выбрать страну", "Select country")}>
      {codes.map((code) => {
        const row = countries.find((item) => item.cc === code), revenue = row?.metrics.revenue;
        return <button key={code} type="button" onClick={() => onSelect(code)} aria-pressed={selected === code} className={styles.countryCard} title={dt(countryName(code), row?.name ?? code)}>
          <span className={styles.countryTitle}><span className={styles.countryCode}>{code}</span><strong>{dt(countryName(code), row?.name ?? code)}</strong></span>
          {loading ? <span className="roy-shim block h-6 w-20 rounded-md" /> : <CockpitValue metric="revenue" value={revenue?.current} compact />}
          {!loading && <CockpitDelta metric="revenue" current={revenue?.current} previous={revenue?.[comparison]} />}
          {!loading && (!revenue || revenue.current.status !== "complete" || revenue.current.stale) && <CockpitMetricStatus value={revenue?.current} />}
        </button>;
      })}
    </div>
    <CockpitHero code={selected} country={country} metric={metric} comparison={comparison} onRevenue={() => setMetric("revenue")} loading={loading} />
    <div className={styles.metricGrid} role="group" aria-label={dt("Показатель на большом графике", "Metric shown in the chart")}>
      {PERFORMANCE_METRICS.map((key) => {
        const values = country?.metrics[key];
        return <button key={key} type="button" onClick={() => setMetric(key)} className={styles.metricButton} aria-pressed={metric === key} aria-controls="home-cockpit-metric">
          <span className={styles.metricLabel}>{dt(...COCKPIT_METRIC_LABELS[key])}</span>
          <span className={styles.metricSummary}><CockpitValue metric={key} value={values?.current} compact /><CockpitDelta metric={key} current={values?.current} previous={values?.[comparison]} /></span>
          {!loading && <CockpitMetricStatus value={values?.current} compact />}
          <span className={styles.metricAction}>{metric === key ? dt("На графике", "On chart") : dt("Показать график", "Show chart")} →</span>
        </button>;
      })}
    </div>
    {children}
    {showUnits && <CockpitUnits country={country} metric={metric} comparison={comparison} />}
  </div>;
}
