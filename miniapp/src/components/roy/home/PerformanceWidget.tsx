"use client";
import { useEffect, useState } from "react";
import { useDt } from "../nav";
import { fetchPerformance, PERFORMANCE_METRICS, performanceDirection, performanceNumber, type MetricValue, type PerformanceData, type PerformanceMetric, type PerformanceValues } from "@/lib/performance";

const LABELS: Record<PerformanceMetric, [string, string]> = {
  revenue: ["Выручка без НДС", "Revenue excl. VAT"], orders: ["Заказы", "Orders"],
  delivery_seconds: ["Доставка", "Delivery"], restaurant_cooking_seconds: ["Приготовление в ресторане", "Restaurant cooking"],
  stops_seconds: ["Стопы каналов", "Channel stops"], certificates_count: ["Сертификаты за опоздание", "Late delivery vouchers"],
};

function valueText(metric: PerformanceMetric, value: MetricValue, language: string): string {
  const number = performanceNumber(value.value);
  if (number === null) return "—";
  const formatter = new Intl.NumberFormat(language, { maximumFractionDigits: metric === "revenue" ? 0 : 1 });
  if (metric === "revenue") return `${formatter.format(number)} ${value.currency ?? ""}`.trim();
  if (metric.endsWith("seconds")) return `${formatter.format(number / 60)} ${language === "ru" ? "мин" : "min"}`;
  return formatter.format(number);
}

function Delta({ metric, value }: { metric: PerformanceMetric; value: MetricValue }) {
  const number = performanceNumber(value.delta_pct);
  const tone = performanceDirection(metric, value.delta_pct);
  const cls = tone === "good" ? "text-[var(--status-done)]" : tone === "bad" ? "text-[var(--pri-high)]" : "text-ink-mute";
  return <span className={`block font-mono text-[11px] ${cls}`}>
    {number === null ? "—" : `${number > 0 ? "▲" : number < 0 ? "▼" : "●"} ${Math.abs(number).toFixed(1)}%`}
  </span>;
}

function Cells({ values, comparison, lang }: { values: PerformanceValues; comparison: "mom" | "yoy"; lang: string }) {
  const dt = useDt();
  return PERFORMANCE_METRICS.map((metric) => {
    const row = values[metric];
    const value = row.current;
    const previous = row[comparison];
    const incomplete = value.status === "partial";
    const cover = value.coverage;
    const title = [
      `${dt("Предыдущий период", "Previous period")}: ${valueText(metric, previous, lang)}`,
      cover?.scope === "source_country" ? dt("Итог страны из Dodo IS", "Country total from Dodo IS") : cover ? `${dt("Покрытие пиццерий", "Pizzeria coverage")}: ${cover.covered_units ?? "?"}/${cover.expected_units ?? "?"}` : "",
      value.loaded_at ? `${dt("Обновлено", "Updated")}: ${new Date(value.loaded_at).toLocaleString(lang)}` : "",
    ].filter(Boolean).join(" · ");
    return <td key={metric} className="whitespace-nowrap border-t border-line px-3 py-2 align-top" title={title}>
      <span className="font-mono text-[13px]">{valueText(metric, value, lang)}</span>
      <Delta metric={metric} value={previous} />
      {(incomplete || value.stale) && <span className="block text-[10px] text-ink-mute">{incomplete ? dt("часть данных", "partial data") : dt("давно обновлено", "outdated")}</span>}
    </td>;
  });
}

const previousDayMonth = () => {
  const stamp = new Date(); stamp.setDate(stamp.getDate() - 1);
  return `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}`;
};

export function PerformanceWidget({ codes }: { codes: string[] }) {
  const dt = useDt();
  const lang = dt("ru", "en");
  const [month, setMonth] = useState(previousDayMonth);
  const [comparison, setComparison] = useState<"mom" | "yoy">("mom");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [state, setState] = useState<{ key: string; data: PerformanceData | null; failed: boolean }>({ key: "", data: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const key = [...new Set(codes)].sort().join(",");
  const resourceKey = `${key}|${month}|${attempt}`;
  useEffect(() => {
    let alive = true;
    const [year, number] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    const current = new Date().toISOString().slice(0, 7);
    const asOf = month === current ? undefined : last;
    fetchPerformance(key.split(","), asOf).then(
      (data) => { if (alive) setState({ key: resourceKey, data, failed: false }); },
      () => { if (alive) setState({ key: resourceKey, data: null, failed: true }); },
    );
    return () => { alive = false; };
  }, [key, month, resourceKey]);
  const loading = state.key !== resourceKey;
  const countries = loading ? [] : state.data?.countries ?? [];
  return <div className="min-h-0 rounded-[12px] border border-line bg-surface p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
      <label className="flex items-center gap-2 text-ink-soft">{dt("Месяц", "Month")}<input type="month" aria-label={dt("Месяц операционных показателей", "Performance month")} value={month} max={previousDayMonth()} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value); }} className="rounded-md border border-line bg-surface px-2 py-1 text-ink" /></label>
      <div className="flex gap-1" role="group" aria-label={dt("Сравнение", "Comparison")}>
        {(["mom", "yoy"] as const).map((kind) => <button key={kind} type="button" aria-pressed={comparison === kind} onClick={() => setComparison(kind)} className={`rounded-md border px-2 py-1 ${comparison === kind ? "border-accent-line bg-surface-2 text-ink" : "border-line text-ink-mute"}`}>{kind === "mom" ? dt("К прошлому месяцу", "Previous month") : dt("К прошлому году", "Previous year")}</button>)}
      </div>
    </div>
    {loading && <p className="py-6 text-center text-sm text-ink-mute">{dt("Загружаем показатели…", "Loading performance…")}</p>}
    {!loading && state.failed && <p className="py-6 text-center text-sm text-ink-soft">{dt("Показатели сейчас недоступны.", "Performance is currently unavailable.")} <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>{dt("Повторить", "Retry")}</button></p>}
    {!loading && !state.failed && !countries.length && <p className="py-6 text-center text-sm text-ink-mute">{dt("За выбранный период данных ещё нет.", "No data for this period yet.")}</p>}
    {!!countries.length && <div className="overflow-x-auto"><table className="w-full border-collapse text-left">
      <thead><tr className="text-[11px] text-ink-mute"><th className="min-w-40 px-3 py-2">{dt("Страна / пиццерия", "Country / pizzeria")}</th>{PERFORMANCE_METRICS.map((metric) => <th key={metric} className="min-w-28 px-3 py-2 font-medium">{LABELS[metric][lang === "ru" ? 0 : 1]}</th>)}</tr></thead>
      {countries.map((country) => <tbody key={country.cc}>
        <tr className="bg-surface-2"><th className="border-t border-line px-3 py-2 font-medium"><button type="button" aria-expanded={expanded.includes(country.cc)} onClick={() => setExpanded((before) => before.includes(country.cc) ? before.filter((cc) => cc !== country.cc) : [...before, country.cc])} className="text-left"><span aria-hidden="true">{expanded.includes(country.cc) ? "▾" : "▸"}</span> {country.name}<small className="block pl-3 text-[10px] font-normal text-ink-mute">{country.periods.current.from} — {country.periods.current.to}</small></button></th><Cells values={country.metrics} comparison={comparison} lang={lang} /></tr>
        {expanded.includes(country.cc) && country.units.map((unit) => <tr key={unit.dodo_id}><th className="border-t border-line px-3 py-2 pl-6 text-[12px] font-normal">{unit.name}</th><Cells values={unit.metrics} comparison={comparison} lang={lang} /></tr>)}
        {expanded.includes(country.cc) && <tr><td colSpan={7} className="border-t border-line px-3 py-2 text-[11px] text-ink-mute">{dt("Сравниваем одинаковую дату отсечения месяца. Доставка — от заказа до клиента. Средние учитывают исключения Dodo IS.", "Comparisons use the same calendar cutoff. Delivery is order to customer. Averages follow Dodo IS exclusions.")} {country.lfl.length > 0 ? dt("LFL источника получен; соответствие этому срезу проверяется.", "Source LFL received; matching this slice is being verified.") : dt("LFL этого среза ещё не подтверждён.", "LFL for this slice is not yet confirmed.")}</td></tr>}
      </tbody>)}
    </table></div>}
    <p className="mt-3 text-[10px] text-ink-mute">{dt("Decimus · по последний завершённый день · — нет подтверждённых данных · ▲▼ изменение, цвет учитывает смысл показателя", "Decimus · through the last completed day · — unconfirmed data · ▲▼ change, color reflects the metric")}</p>
  </div>;
}
