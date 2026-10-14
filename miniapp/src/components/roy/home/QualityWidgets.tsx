"use client";
import type { ReactNode } from "react";
import { useDt } from "../nav";
import { LineChart, type ChartSeries } from "./LineChart";
import { CountryMenu, PeriodMenu, SERIES_COLORS, useChartPrefs, type ChartPrefs } from "./ChartControls";
import { countryName } from "@/lib/countries";
import { alignTo, bucketize, niceScale, type Grain, type MonthRange } from "@/lib/homeChartSeries";
import {
  RKO_CRIT, RKO_DROP, RKO_NORM, RKO_WARN, RS_CRIT, RS_NORM, RS_WARN,
  chartBounds, countryOf, latestWave, latestWeek, selectionHistory, selectionMean,
  type CountryQuality, type Pizzeria, type QualityKind, type QualityModel,
} from "@/lib/homeQuality";
import { VIOLATIONS } from "@/lib/homeQualitySample";

// Виджеты РС (стандарты) и РКО (клиентский опыт) по подборке стран. Баллы — настоящие, GET /quality
// (модель — lib/homeQuality.ts). Метрики без источника (собираемость инспектором, отчёты гостей)
// сняты, а не нарисованы. «Топ-5 нарушений» — пока образец (lib/homeQualitySample.ts).

export type Tone = "good" | "warn" | "bad" | "";
export const TONE_TEXT: Record<Tone, string> = {
  good: "text-[var(--status-done)]", warn: "text-[var(--pri-med)]", bad: "text-[var(--pri-high)]", "": "text-ink",
};
export const TONE_CELL: Record<Tone, string> = {
  good: "bg-[color-mix(in_srgb,var(--status-done)_12%,transparent)] text-[var(--status-done)]",
  warn: "bg-[color-mix(in_srgb,var(--pri-med)_14%,transparent)] text-[var(--pri-med)]",
  bad: "bg-[color-mix(in_srgb,var(--pri-high)_12%,transparent)] text-[var(--pri-high)]",
  "": "bg-surface-2 text-ink-mute",
};
export const tone = (v: number | null, good: number, warn: number): Tone => (v == null ? "" : v >= good ? "good" : v >= warn ? "warn" : "bad");

export function Delta({ v, digits = 1, small }: { v: number | null; digits?: number; small?: boolean }) {
  if (v == null) return null;
  const cls = v > 0 ? "text-[var(--status-done)]" : v < 0 ? "text-[var(--pri-high)]" : "text-ink-mute";
  const sign = v > 0 ? "▲" : v < 0 ? "▼" : "●";
  return <span className={`font-mono ${cls}`} style={{ fontSize: small ? 11 : 12 }}>{sign} {Math.abs(v).toFixed(digits)}</span>;
}

export function SampleTag() {
  const dt = useDt();
  return (
    <span className="rounded-full border border-dashed border-line-2 px-2 py-0.5 text-ink-mute" style={{ fontSize: 10.5 }}
      title={dt("Нарушений стандартов ещё нет в Swarm — цифры для вида", "Standards violations aren't in Swarm yet — sample numbers")}>
      {dt("образец данных", "sample data")}
    </span>
  );
}

function Stat({ label, value, cls, note }: { label: string; value: ReactNode; cls?: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line px-2.5 py-2">
      <span className="text-ink-mute" style={{ fontSize: 11, lineHeight: 1.3 }}>{label}</span>
      <b className={`font-mono font-semibold ${cls ?? "text-ink"}`} style={{ fontSize: 18 }}>{value}</b>
      {note && <small className="truncate text-ink-soft" style={{ fontSize: 11 }}>{note}</small>}
    </div>
  );
}

function Hero({ value, max, delta, deltaNote, normOk, normText, bench }: {
  value: number | null; max: number; delta: number | null; deltaNote: string; normOk: Tone; normText: string; bench: string;
}) {
  return (
    <div>
      <div className="mt-1 font-mono font-semibold leading-none text-ink" style={{ fontSize: 46, letterSpacing: "-0.03em" }}>
        {value == null ? "—" : value.toFixed(1)}<small className="ml-1 font-medium text-ink-mute" style={{ fontSize: 15 }}>/{max}</small>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
        <Delta v={delta} /> <span className="text-ink-mute">{deltaNote}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${TONE_CELL[normOk]}`} style={{ fontSize: 11 }}>{normText}</span>
        <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{bench}</span>
      </div>
    </div>
  );
}

function Legend({ series, norm }: { series: ChartSeries[]; norm: string }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-ink-soft" style={{ fontSize: 11.5 }}>
      {series.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5">
          <i className="inline-block h-0.5 w-3.5" style={s.dashed
            ? { backgroundImage: `linear-gradient(90deg, ${s.color} 60%, transparent 0)`, backgroundSize: "5px 2px" }
            : { background: s.color }} />{s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-[var(--status-done)] opacity-30" />{norm}</span>
    </div>
  );
}

/**
 * График рейтинга с настройками: страны (одной линией «мои» или линия на страну) и период
 * «с — по» с разбивкой. IMF (все страны с данными) — пунктиром для сравнения, в любом режиме.
 * Монтируется, когда данные уже пришли: границы периода считаются по ним.
 */
function RatingChart({ id, kind, q, scope, bounds, months, grains, norm, normLabel, fmt, aria }: {
  id: string; kind: QualityKind; q: QualityModel; scope: CountryQuality[]; bounds: MonthRange; months: number;
  grains: Grain[]; norm: number; normLabel: string; fmt: (v: number) => string; aria: string;
}) {
  const dt = useDt();
  const en = dt("ru", "en") === "en";
  const initial: ChartPrefs = { countries: [], range: chartBounds(bounds, months).defaults, grain: grains[0] };
  const [prefs, update] = useChartPrefs(id, initial, bounds, grains);
  const series = (list: CountryQuality[]) => bucketize(selectionHistory(q, list, kind), prefs.range, prefs.grain, en);
  // Ось — корзины IMF: в них есть данные хоть одной страны, ряды стран выравниваются по ним.
  const imfBuckets = series(q.countries);
  const keys = imfBuckets.map((b) => b.key);
  const lines: ChartSeries[] = prefs.countries.length
    ? prefs.countries.map((cc, i) => ({
      id: cc, label: dt(countryName(cc), cc), color: SERIES_COLORS[i], values: alignTo(keys, series([countryOf(q, cc)])),
    }))
    : [{ id: "mine", label: dt("Мои страны", "My countries"), color: "var(--primary)", values: alignTo(keys, series(scope)) }];
  const all: ChartSeries[] = [...lines, { id: "imf", label: "IMF", color: "var(--ink-mute)", values: imfBuckets.map((b) => b.value), dashed: true }];
  const scale = niceScale(all.flatMap((s) => s.values).filter((v): v is number => v != null), norm);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <CountryMenu value={prefs.countries} onChange={(countries) => update({ countries })} mine={scope.map((c) => c.cc)} />
        <PeriodMenu range={prefs.range} grain={prefs.grain} grains={grains} bounds={bounds}
          defaults={initial} onChange={update} />
      </div>
      <Legend series={all} norm={normLabel} />
      <LineChart labels={imfBuckets.map((b) => b.label)} series={all} norm={norm}
        min={scale.min} max={scale.max} ticks={scale.ticks} fmt={fmt} ariaLabel={aria} />
    </div>
  );
}

const card = "flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4";
/** Подпись под плашкой: две первые пиццерии списка или текст «нет». */
const firstTwo = (list: Pizzeria[], show: (p: Pizzeria) => string, none: string) => list.slice(0, 2).map(show).join(", ") || none;

type Props = { q: QualityModel; scope: CountryQuality[] };

export function RsWidget({ q, scope }: Props) {
  const dt = useDt();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const rs = selectionMean(scope, (p) => p.rs);
  const prev = selectionMean(scope, (p) => p.rsPrev);
  const imfRs = selectionMean(q.countries, (p) => p.rs);
  const pz = scope.flatMap((c) => c.pizzerias);
  const rated = pz.filter((p) => p.rs != null);
  const crit = rated.filter((p) => (p.rs ?? 100) < RS_CRIT).sort((a, b) => (a.rs ?? 0) - (b.rs ?? 0));
  const zeroed = rated.filter((p) => p.rs === 0);
  const onTarget = rated.filter((p) => (p.rs ?? 0) >= RS_NORM).length;
  const missed = pz.filter((p) => p.rsMissed);
  const wave = latestWave(q, lang);
  const t = tone(rs, RS_NORM, RS_WARN);
  const none = dt("нет", "none");
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <Hero value={rs} max={100} delta={rs != null && prev != null ? rs - prev : null}
          deltaNote={dt("к прошлой волне", "vs previous wave")} normOk={t}
          normText={t === "good" ? dt("в норме", "on target") : dt(`ниже нормы ${RS_NORM}`, `below ${RS_NORM}`)}
          bench={`IMF ${imfRs?.toFixed(1) ?? "—"}`} />
        {wave && (
          <div className="whitespace-nowrap text-right text-ink-mute" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {dt("волна", "wave")} <b className="text-ink">{wave.name}</b><br />{wave.days}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 min-[1400px]:grid-cols-4">
        <Stat label={dt(`Критическая зона <${RS_CRIT}`, `Critical <${RS_CRIT}`)} value={`${crit.length} / ${rated.length}`}
          cls={TONE_TEXT[crit.length ? "bad" : "good"]} note={firstTwo(crit, (p) => `${p.name} ${p.rs}`, none)} />
        <Stat label={dt("Обнуления", "Zeroed")} value={zeroed.length} cls={TONE_TEXT[zeroed.length ? "bad" : "good"]}
          note={zeroed.length ? firstTwo(zeroed, (p) => p.name, none) : dt("балл 0 в волне", "score 0 this wave")} />
        <Stat label={dt(`Пиццерий в норме ≥${RS_NORM}`, `On target ≥${RS_NORM}`)} value={`${onTarget} / ${rated.length}`} />
        <Stat label={dt("Без оценки в волне", "Not rated this wave")} value={missed.length} cls={TONE_TEXT[missed.length ? "warn" : "good"]}
          note={firstTwo(missed, (p) => p.name, dt("все оценены", "all rated"))} />
      </div>
      {q.rsBounds && (
        <RatingChart id="rs" kind="rs" q={q} scope={scope} bounds={q.rsBounds} months={8}
          grains={["wave", "month", "quarter"]} norm={RS_NORM} normLabel={dt(`Норма ≥ ${RS_NORM}`, `Target ≥ ${RS_NORM}`)}
          fmt={(v) => v.toFixed(0)} aria={dt("Средний балл РС", "Average standards score")} />
      )}
    </div>
  );
}

export function RkoWidget({ q, scope }: Props) {
  const dt = useDt();
  const rko = selectionMean(scope, (p) => p.rko);
  const prev = selectionMean(scope, (p) => p.rkoPrev);
  const imfRko = selectionMean(q.countries, (p) => p.rko);
  const pz = scope.flatMap((c) => c.pizzerias);
  const rated = pz.filter((p) => p.rko != null);
  const change = (p: Pizzeria) => (p.rko != null && p.rkoPrev != null ? p.rko - p.rkoPrev : 0);
  const drop = rated.filter((p) => change(p) <= -RKO_DROP).sort((a, b) => change(a) - change(b));
  const crit = rated.filter((p) => (p.rko ?? 100) < RKO_CRIT).sort((a, b) => (a.rko ?? 0) - (b.rko ?? 0));
  const onTarget = rated.filter((p) => (p.rko ?? 0) >= RKO_NORM).length;
  const missed = pz.filter((p) => p.rkoMissed);
  const week = latestWeek(q);
  const t = tone(rko, RKO_NORM, RKO_WARN);
  const none = dt("нет", "none");
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <Hero value={rko} max={100} delta={rko != null && prev != null ? rko - prev : null}
          deltaNote={dt("к прошлой неделе", "vs previous week")} normOk={t}
          normText={t === "good" ? dt("в норме", "on target") : dt(`ниже нормы ${RKO_NORM}`, `below ${RKO_NORM}`)}
          bench={`IMF ${imfRko?.toFixed(1) ?? "—"}`} />
        {week && (
          <div className="whitespace-nowrap text-right text-ink-mute" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {dt("неделя", "week")}<br /><b className="text-ink">{week}</b>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 min-[1400px]:grid-cols-4">
        <Stat label={dt(`Пиццерий в норме ≥${RKO_NORM}`, `On target ≥${RKO_NORM}`)} value={`${onTarget} / ${rated.length}`} />
        <Stat label={dt(`Резкое падение ≥${RKO_DROP}`, `Sharp drop ≥${RKO_DROP}`)} value={drop.length} cls={TONE_TEXT[drop.length ? "warn" : "good"]}
          note={firstTwo(drop, (p) => `${p.name} ${change(p).toFixed(1)}`, none)} />
        <Stat label={dt(`Ниже ${RKO_CRIT}`, `Below ${RKO_CRIT}`)} value={crit.length} cls={TONE_TEXT[crit.length ? "bad" : "good"]}
          note={firstTwo(crit, (p) => `${p.name} ${p.rko?.toFixed(1)}`, none)} />
        <Stat label={dt("Без оценки за неделю", "Not rated this week")} value={missed.length} cls={TONE_TEXT[missed.length ? "warn" : "good"]}
          note={firstTwo(missed, (p) => p.name, dt("все оценены", "all rated"))} />
      </div>
      {q.rkoBounds && (
        <RatingChart id="rko" kind="rko" q={q} scope={scope} bounds={q.rkoBounds} months={2}
          grains={["week", "month", "quarter"]} norm={RKO_NORM} normLabel={dt(`Норма ≥ ${RKO_NORM}`, `Target ≥ ${RKO_NORM}`)}
          fmt={(v) => v.toFixed(1)} aria={dt("Средний балл РКО", "Average CX score")} />
      )}
    </div>
  );
}

export function ViolationsWidget({ scope }: { scope: CountryQuality[] }) {
  const dt = useDt();
  const n = scope.reduce((s, c) => s + c.pizzerias.length, 0);
  const rows = VIOLATIONS.map(([ru, en, k]) => ({ name: dt(ru, en), count: Math.max(1, Math.round(n * k)) }));
  const top = Math.max(...rows.map((r) => r.count));
  return (
    <div className="rounded-[12px] border border-line bg-surface p-4">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-3 py-1.5" style={{ fontSize: 12.5 }}>
          <span className="truncate text-ink">{r.name}</span>
          <span className="h-2 rounded-full bg-surface-2"><i className="block h-2 rounded-full bg-primary" style={{ width: `${(r.count / top) * 100}%` }} /></span>
          <b className="text-right font-mono text-ink">{r.count}</b>
        </div>
      ))}
    </div>
  );
}
