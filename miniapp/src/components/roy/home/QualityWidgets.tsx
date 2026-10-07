"use client";
import type { ReactNode } from "react";
import { useDt } from "../nav";
import { LineChart } from "./LineChart";
import {
  COLL_NORM, RKO_NORM, RKO_WARN, RS_CRIT, RS_NORM, RS_WARN, VIOLATIONS, WAVES, WEEKS,
  seriesAvg, waveLabels, weekLabels, weighted, type CountrySample,
} from "@/lib/homeQualitySample";

// Виджеты РС (стандарты) и РКО (клиентский опыт) по подборке стран. Данные — образец
// (lib/homeQualitySample.ts), пока РС и РКО не заведены в Swarm.

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
      title={dt("РС и РКО ещё не заведены в Swarm — цифры для вида", "Standards and CX data aren't in Swarm yet — sample numbers")}>
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

function Legend({ norm }: { norm: string }) {
  const dt = useDt();
  return (
    <div className="flex flex-wrap gap-3 text-ink-soft" style={{ fontSize: 11.5 }}>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0.5 w-3.5 bg-primary" />{dt("Мои страны", "My countries")}</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0.5 w-3.5 bg-ink-mute" />IMF</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-[var(--status-done)] opacity-30" />{norm}</span>
    </div>
  );
}

const card = "flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4";

export function RsWidget({ scope, imf }: { scope: CountrySample[]; imf: CountrySample[] }) {
  const dt = useDt();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const rs = weighted(scope, (c) => c.rs);
  const prev = weighted(scope, (c) => c.rsPrev);
  const imfRs = weighted(imf, (c) => c.rs);
  const pz = scope.flatMap((c) => c.pizzerias);
  const rated = pz.filter((p) => p.rs != null);
  const crit = rated.filter((p) => (p.rs ?? 100) < RS_CRIT).sort((a, b) => (a.rs ?? 0) - (b.rs ?? 0));
  const coll = weighted(scope, (c) => c.coll);
  const noInsp = pz.filter((p) => p.kind === "self" || p.kind === "none").length;
  const t = tone(rs, RS_NORM, RS_WARN);
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <Hero value={rs} max={100} delta={rs != null && prev != null ? rs - prev : null}
          deltaNote={dt("к прошлой волне", "vs previous wave")} normOk={t}
          normText={t === "good" ? dt("в норме", "on target") : dt(`ниже нормы ${RS_NORM}`, `below ${RS_NORM}`)}
          bench={`IMF ${imfRs?.toFixed(1) ?? "—"}`} />
        <div className="whitespace-nowrap text-right text-ink-mute" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {dt("волна", "wave")} <b className="text-ink">{dt("Сентябрь 2", "September 2")}</b><br />{dt("15–30 сентября", "Sep 15–30")}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 min-[1400px]:grid-cols-4">
        <Stat label={dt(`Критическая зона <${RS_CRIT}`, `Critical <${RS_CRIT}`)} value={`${crit.length} / ${rated.length}`}
          cls={TONE_TEXT[crit.length ? "bad" : "good"]} note={crit.slice(0, 2).map((p) => `${p.name} ${p.rs}`).join(", ") || dt("нет", "none")} />
        <Stat label={dt("Обнуления", "Zeroed")} value="0" cls={TONE_TEXT.good} note={dt("за волну", "this wave")} />
        <Stat label={dt("Собираемость инспектором", "Inspector coverage")} value={coll == null ? "—" : `${coll.toFixed(0)}%`}
          cls={TONE_TEXT[tone(coll, COLL_NORM, 70)]} note={dt(`норма >${COLL_NORM}%`, `target >${COLL_NORM}%`)} />
        <Stat label={dt("Без инспектора", "No inspector")} value={noInsp} cls={TONE_TEXT[noInsp ? "warn" : "good"]}
          note={dt("самопроверка или не найдено", "self-check or not found")} />
      </div>
      <Legend norm={dt(`Норма ≥ ${RS_NORM}`, `Target ≥ ${RS_NORM}`)} />
      <LineChart labels={waveLabels(lang)} mine={seriesAvg(scope, (c) => c.rsWaves, WAVES)} imf={seriesAvg(imf, (c) => c.rsWaves, WAVES)}
        norm={RS_NORM} min={60} max={100} ticks={[60, 70, 80, 90, 100]} fmt={(v) => v.toFixed(0)}
        ariaLabel={dt("Средний балл РС по волнам", "Average standards score by wave")}
        mineLabel={dt("Мои", "Mine")} imfLabel="IMF" />
    </div>
  );
}

export function RkoWidget({ scope, imf }: { scope: CountrySample[]; imf: CountrySample[] }) {
  const dt = useDt();
  const rko = weighted(scope, (c) => c.rko);
  const prev = weighted(scope, (c) => c.rkoPrev);
  const imfRko = weighted(imf, (c) => c.rko);
  const pz = scope.flatMap((c) => c.pizzerias);
  const restOk = pz.length ? (pz.filter((p) => p.cliRest > 0).length / pz.length) * 100 : null;
  const delivOk = pz.length ? (pz.filter((p) => p.cliDeliv > 0).length / pz.length) * 100 : null;
  const drop = pz.filter((p) => p.rko - p.rkoPrev <= -3).sort((a, b) => (a.rko - a.rkoPrev) - (b.rko - b.rkoPrev));
  const t = tone(rko, RKO_NORM, RKO_WARN);
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <Hero value={rko} max={100} delta={rko != null && prev != null ? rko - prev : null}
          deltaNote={dt("к прошлой неделе", "vs previous week")} normOk={t}
          normText={t === "good" ? dt("в норме", "on target") : dt(`ниже нормы ${RKO_NORM}`, `below ${RKO_NORM}`)}
          bench={`IMF ${imfRko?.toFixed(1) ?? "—"}`} />
        <div className="whitespace-nowrap text-right text-ink-mute" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {dt("неделя", "week")} <b className="text-ink">28.09 — 04.10</b><br />{dt("отчёты гостей", "guest reports")}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 min-[1400px]:grid-cols-4">
        <Stat label={dt("Отчёты · ресторан", "Reports · dine-in")} value={restOk == null ? "—" : `${restOk.toFixed(0)}%`}
          cls={TONE_TEXT[tone(restOk, 100, 75)]} note={dt(`${pz.filter((p) => !p.cliRest).length} без отчёта`, `${pz.filter((p) => !p.cliRest).length} without`)} />
        <Stat label={dt("Отчёты · доставка", "Reports · delivery")} value={delivOk == null ? "—" : `${delivOk.toFixed(0)}%`}
          cls={TONE_TEXT[tone(delivOk, 100, 75)]} note={dt(`${pz.filter((p) => !p.cliDeliv).length} без отчёта`, `${pz.filter((p) => !p.cliDeliv).length} without`)} />
        <Stat label={dt("Пиццерий в норме", "Pizzerias on target")} value={`${pz.filter((p) => p.rko >= RKO_NORM).length} / ${pz.length}`} />
        <Stat label={dt("Резкое падение ≥3", "Sharp drop ≥3")} value={drop.length} cls={TONE_TEXT[drop.length ? "warn" : "good"]}
          note={drop.slice(0, 2).map((p) => `${p.name} ${(p.rko - p.rkoPrev).toFixed(1)}`).join(", ") || dt("нет", "none")} />
      </div>
      <Legend norm={dt(`Норма ≥ ${RKO_NORM}`, `Target ≥ ${RKO_NORM}`)} />
      <LineChart labels={weekLabels()} mine={seriesAvg(scope, (c) => c.rkoWeeks, WEEKS)} imf={seriesAvg(imf, (c) => c.rkoWeeks, WEEKS)}
        norm={RKO_NORM} min={86} max={98} ticks={[86, 90, 94, 98]} fmt={(v) => v.toFixed(1)}
        ariaLabel={dt("Средний балл РКО по неделям", "Average CX score by week")}
        mineLabel={dt("Мои", "Mine")} imfLabel="IMF" />
    </div>
  );
}

export function ViolationsWidget({ scope }: { scope: CountrySample[] }) {
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
