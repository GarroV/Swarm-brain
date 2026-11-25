"use client";
import { useState } from "react";
import { PERFORMANCE_METRICS, performancePeriodLabel, type PerformanceCountry, type PerformanceMetric } from "@/lib/performance";
import { useDt } from "../nav";
import { CockpitDelta, CockpitMetricStatus, CockpitValue } from "./CockpitMetric";
import { COCKPIT_METRIC_LABELS, type CockpitComparison } from "./cockpitFormat";
import styles from "./cockpit.module.css";

export function CockpitUnits({ country, metric, comparison }: { country?: PerformanceCountry; metric: PerformanceMetric; comparison: CockpitComparison }) {
  const dt = useDt();
  const [selected, setSelected] = useState<string | null>(null);
  const open = country?.units.find((unit) => unit.dodo_id === selected);
  return <section className={styles.unitSection}>
    <div className={styles.sectionHeading}><h2>{dt("Показатели пиццерий", "Pizzeria performance")}</h2><span>{country ? performancePeriodLabel(country.periods.current) : "—"}</span></div>
    {!country?.units.length ? <div className={styles.empty}>{dt("Подтверждённых данных по отдельным пиццериям пока нет", "No confirmed per-pizzeria data yet")}</div> : <div className={styles.unitGrid}>
      {country.units.map((unit) => <button key={unit.dodo_id} type="button" className={styles.unitButton} onClick={() => setSelected((before) => before === unit.dodo_id ? null : unit.dodo_id)} aria-expanded={selected === unit.dodo_id}>
        <strong>{unit.name}<span aria-hidden> →</span></strong><CockpitValue metric={metric} value={unit.metrics[metric]?.current} compact /><CockpitDelta metric={metric} current={unit.metrics[metric]?.current} previous={unit.metrics[metric]?.[comparison]} /><CockpitMetricStatus value={unit.metrics[metric]?.current} compact />
      </button>)}
    </div>}
    {open && <div className={styles.unitDetails}>
      <div className={styles.sectionHeading}><h3>{open.name}</h3><button type="button" onClick={() => setSelected(null)} className={styles.textButton}>{dt("Свернуть", "Close")} ×</button></div>
      <div className={styles.metricGrid}>{PERFORMANCE_METRICS.map((key) => <div key={key} className={styles.metricReadOnly}>
        <span className={styles.metricLabel}>{dt(...COCKPIT_METRIC_LABELS[key])}</span><CockpitValue metric={key} value={open.metrics[key]?.current} /><CockpitDelta metric={key} current={open.metrics[key]?.current} previous={open.metrics[key]?.[comparison]} full /><CockpitMetricStatus value={open.metrics[key]?.current} />
      </div>)}</div>
    </div>}
  </section>;
}
