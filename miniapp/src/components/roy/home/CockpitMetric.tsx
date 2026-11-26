"use client";
import { performanceDirection, performanceNumber, type MetricValue, type PerformanceMetric } from "@/lib/performance";
import { useDt } from "../nav";
import { cockpitComparable, cockpitUnit, cockpitValue } from "./cockpitFormat";
import styles from "./cockpit.module.css";

export function CockpitValue({ metric, value, compact = false }: { metric: PerformanceMetric; value?: MetricValue; compact?: boolean }) {
  const dt = useDt(), locale = dt("ru-RU", "en-GB");
  return <span className={styles.value}>{cockpitValue(metric, value, locale, compact)}<small>{cockpitUnit(metric, value, dt("ru", "en") === "ru")}</small></span>;
}

export function CockpitDelta({ metric, current, previous, full = false }: { metric: PerformanceMetric; current?: MetricValue; previous?: MetricValue; full?: boolean }) {
  const dt = useDt(), locale = dt("ru-RU", "en-GB");
  const percentage = performanceNumber(previous?.delta_pct);
  if (!cockpitComparable(metric, current, previous)) {
    const currencyChanged = metric === "revenue" && current?.currency && previous?.currency && current.currency !== previous.currency;
    return <span className={styles.unavailable}>{currencyChanged ? dt("Валюта изменилась — нужна приведённая база", "Currency changed; a converted baseline is needed") : dt("Нет полного сравнения", "Complete comparison unavailable")}</span>;
  }
  if (percentage === null) return <span className={styles.unavailable}>{dt("Изменение не рассчитано", "Change not calculated")}</span>;
  const tone = performanceDirection(metric, previous?.delta_pct);
  const difference = performanceNumber(previous?.delta);
  const numericDelta = difference === null ? null : { ...previous!, value: String(Math.abs(difference)) };
  return <span className={`${styles.delta} ${tone === "good" ? styles.good : tone === "bad" ? styles.bad : ""}`}>
    {percentage > 0 ? "▲ +" : percentage < 0 ? "▼ −" : "→ "}{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(percentage))}%
    {full && numericDelta && <span className={styles.absoluteDelta}>{difference! < 0 ? "−" : difference! > 0 ? "+" : ""}{cockpitValue(metric, numericDelta, locale)} {cockpitUnit(metric, current, dt("ru", "en") === "ru")}</span>}
  </span>;
}

export function CockpitMetricStatus({ value, compact = false }: { value?: MetricValue; compact?: boolean }) {
  const dt = useDt();
  if (!value || performanceNumber(value.value) === null || value.status === "unavailable") return <span className={styles.unavailable}>{dt("Нет подтверждённых данных", "No confirmed data")}</span>;
  const cover = value.coverage;
  return <span className={styles.metricStatus}>
    {value.status === "partial" && <span className={styles.warning}>{dt("Часть данных", "Partial data")}{cover && ` · ${cover.covered_units ?? "?"}/${cover.expected_units ?? "?"}`}</span>}
    {value.stale && <span className={styles.warning}>{dt("Данные давно не обновлялись", "Data is outdated")}</span>}
    {!compact && value.loaded_at && <span>{dt("Обновлено", "Updated")}: {Number.isFinite(Date.parse(value.loaded_at)) ? new Date(value.loaded_at).toLocaleString(dt("ru-RU", "en-GB"), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span>}
    {!compact && cover?.scope === "source_country" && <span>{dt("Итог страны из Dodo IS", "Country total from Dodo IS")}</span>}
  </span>;
}
