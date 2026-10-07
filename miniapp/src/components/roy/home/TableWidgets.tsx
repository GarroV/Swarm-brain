"use client";
import { useMemo, useState } from "react";
import { useDt } from "../nav";
import { MiniSpark } from "./LineChart";
import { Delta, TONE_CELL, tone } from "./QualityWidgets";
import { fmtEur, type SalesState } from "./useCountrySales";
import { countryFlag, countryName } from "@/lib/countries";
import {
  COLL_NORM, RKO_NORM, RKO_WARN, RS_CRIT, RS_NORM, weighted,
  type CheckKind, type CountrySample, type PizzeriaSample,
} from "@/lib/homeQualitySample";

// Таблицы главной: все пиццерии подборки, «Куда смотреть» (сигналы по порогам) и «Мои страны».

const card = "rounded-[12px] border border-line bg-surface";
const th = "sticky top-0 bg-surface px-2.5 py-2 text-left font-semibold uppercase text-ink-mute";
const td = "border-t border-line px-2.5 py-2";

function Cell({ v, t, digits = 0 }: { v: number | null; t: ReturnType<typeof tone>; digits?: number }) {
  return <span className={`inline-block min-w-[38px] rounded-[6px] px-1.5 py-0.5 text-center font-mono ${TONE_CELL[t]}`} style={{ fontSize: 12 }}>{v == null ? "—" : v.toFixed(digits)}</span>;
}

function Tabs<K extends string>({ tabs, value, onChange }: { tabs: Array<[K, string, number]>; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3" role="tablist">
      {tabs.map(([k, label, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${value === k ? "border-ink bg-ink text-background" : "border-line-2 text-ink-soft hover:border-accent-line hover:text-primary"}`}
          style={{ fontSize: 12 }}>
          {label} <span className="opacity-60">{n}</span>
        </button>
      ))}
    </div>
  );
}

function kindLabel(k: CheckKind, dt: (ru: string, en: string) => string): [string, string] {
  if (k === "inspector") return [dt("инспектор", "inspector"), "border-line-2 text-ink-soft"];
  if (k === "online") return [dt("онлайн", "online"), "border-accent-line text-primary"];
  if (k === "self") return [dt("самопроверка", "self-check"), "border-[var(--pri-med)] text-[var(--pri-med)]"];
  return [dt("не найдено", "not found"), "border-[var(--pri-high)] text-[var(--pri-high)]"];
}

type PzFilter = "all" | "crit" | "rko" | "noRep" | "drop" | "noInsp";
const PZ_FILTERS: Record<PzFilter, (p: PizzeriaSample) => boolean> = {
  all: () => true,
  crit: (p) => p.rs != null && p.rs < RS_CRIT,
  rko: (p) => p.rko < RKO_WARN,
  noRep: (p) => p.cliRest === 0 || p.cliDeliv === 0,
  drop: (p) => (p.rs != null && p.rsPrev != null && p.rs - p.rsPrev <= -8) || p.rko - p.rkoPrev <= -3,
  noInsp: (p) => p.kind === "self" || p.kind === "none",
};

export function PizzeriasWidget({ scope }: { scope: CountrySample[] }) {
  const dt = useDt();
  const [f, setF] = useState<PzFilter>("all");
  const all = useMemo(() => scope.flatMap((c) => c.pizzerias).sort((a, b) => (a.rs ?? 101) - (b.rs ?? 101)), [scope]);
  const labels: Record<PzFilter, string> = {
    all: dt("Все", "All"), crit: dt(`РС ниже ${RS_CRIT}`, `Standards <${RS_CRIT}`), rko: dt("РКО ниже нормы", "CX below target"),
    noRep: dt("Без отчётов", "No reports"), drop: dt("Падение", "Dropping"), noInsp: dt("Без инспектора", "No inspector"),
  };
  const tabs = (Object.keys(PZ_FILTERS) as PzFilter[]).map((k) => [k, labels[k], all.filter(PZ_FILTERS[k]).length] as [PzFilter, string, number]);
  const rows = all.filter(PZ_FILTERS[f]);
  return (
    <div className={card}>
      <Tabs tabs={tabs} value={f} onChange={setF} />
      <div className="mt-2 max-h-[520px] overflow-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
            <tr>
              <th className={th}>{dt("Пиццерия", "Pizzeria")}</th><th className={th}>{dt("РС", "Std")}</th>
              <th className={`${th} max-[900px]:hidden`}>{dt("6 волн", "6 waves")}</th><th className={`${th} max-[900px]:hidden`}>{dt("Проверка", "Check")}</th>
              <th className={th}>{dt("РКО", "CX")}</th><th className={`${th} max-[900px]:hidden`}>{dt("Отчёты · рест / дост", "Reports · in / deliv")}</th>
              <th className={`${th} max-[900px]:hidden`}>{dt("Карты ★", "Maps ★")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const [kl, kc] = kindLabel(p.kind, dt);
              return (
                <tr key={p.name} className="hover:bg-surface-2">
                  <td className={td}><span className="font-medium text-ink">{p.name}</span> <span className="ml-1 text-ink-mute" style={{ fontSize: 11 }}>{countryFlag(p.cc)}</span></td>
                  <td className={td}><Cell v={p.rs} t={tone(p.rs, RS_NORM, RS_CRIT)} /> <Delta v={p.rs != null && p.rsPrev != null ? p.rs - p.rsPrev : null} digits={0} small /></td>
                  <td className={`${td} max-[900px]:hidden`}><MiniSpark values={p.rsHist} /></td>
                  <td className={`${td} max-[900px]:hidden`}><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 ${kc}`} style={{ fontSize: 11 }}>{kl}</span></td>
                  <td className={td}><Cell v={p.rko} t={tone(p.rko, RKO_NORM, RKO_WARN)} digits={1} /> <Delta v={p.rko - p.rkoPrev} small /></td>
                  <td className={`${td} max-[900px]:hidden`}>
                    <Cell v={p.cliRest} t={p.cliRest === 0 ? "bad" : p.cliRest === 1 ? "warn" : "good"} /> <span className="text-ink-mute">/</span>{" "}
                    <Cell v={p.cliDeliv} t={p.cliDeliv === 0 ? "bad" : p.cliDeliv < 3 ? "warn" : "good"} />
                  </td>
                  <td className={`${td} text-ink-mute max-[900px]:hidden`} style={{ fontSize: 11.5 }}>{dt("скоро", "soon")}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className={`${td} py-5 text-center text-ink-mute`}>{dt("Таких пиццерий нет", "No pizzerias here")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Signal = { key: string; area: "crit" | "rs" | "rko" | "ops"; title: string; text: string; value: string; note: string };

export function AttentionWidget({ scope }: { scope: CountrySample[] }) {
  const dt = useDt();
  const [f, setF] = useState<"all" | Signal["area"]>("all");
  const signals = useMemo<Signal[]>(() => {
    const out: Signal[] = [];
    for (const c of scope) {
      for (const p of c.pizzerias) {
        if (p.rs != null && p.rs < RS_CRIT) out.push({ key: `c${p.name}`, area: "crit", title: p.name, text: dt(`РС в критической зоне (ниже ${RS_CRIT})`, `Standards in the critical zone (<${RS_CRIT})`), value: String(p.rs), note: dt(`было ${p.rsPrev}`, `was ${p.rsPrev}`) });
        if (p.rko - p.rkoPrev <= -3) out.push({ key: `k${p.name}`, area: "rko", title: p.name, text: dt("РКО резко упал за неделю", "CX dropped sharply this week"), value: p.rko.toFixed(1), note: (p.rko - p.rkoPrev).toFixed(1) });
        if (p.cliRest === 0) out.push({ key: `o${p.name}`, area: "ops", title: p.name, text: dt("Ни одного отчёта гостя по ресторану за неделю", "No dine-in guest report this week"), value: "0", note: dt("норма ≥2", "target ≥2") });
      }
      if (c.coll < COLL_NORM) out.push({ key: `s${c.cc}`, area: "rs", title: countryName(c.cc), text: dt("Инспектор проверил не все пиццерии волны", "Inspector didn't cover every pizzeria"), value: `${c.coll}%`, note: dt(`норма ${COLL_NORM}%`, `target ${COLL_NORM}%`) });
    }
    const order = { crit: 0, rko: 1, rs: 2, ops: 3 };
    return out.sort((a, b) => order[a.area] - order[b.area]);
  }, [scope, dt]);
  const names = { all: dt("Все", "All"), crit: dt("Критично", "Critical"), rs: dt("РС", "Standards"), rko: dt("РКО", "CX"), ops: dt("Процессы", "Process") };
  const tabs = (["all", "crit", "rs", "rko", "ops"] as const).map((k) => [k, names[k], k === "all" ? signals.length : signals.filter((s) => s.area === k).length] as ["all" | Signal["area"], string, number]);
  const rows = signals.filter((s) => f === "all" || s.area === f).slice(0, 8);
  const icon = { crit: ["!", "bad"], rs: ["◔", "warn"], rko: ["↓", "warn"], ops: ["∅", "warn"] } as const;
  return (
    <div className={card}>
      <Tabs tabs={tabs} value={f} onChange={setF} />
      <div className="mt-2">
        {rows.map((s) => (
          <div key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-3 py-2.5">
            <span className={`grid h-7 w-7 place-items-center rounded-[8px] font-bold ${TONE_CELL[icon[s.area][1]]}`}>{icon[s.area][0]}</span>
            <div className="min-w-0"><div className="truncate font-semibold text-ink" style={{ fontSize: 13 }}>{s.title}</div><div className="truncate text-ink-soft" style={{ fontSize: 12 }}>{s.text}</div></div>
            <div className="text-right"><div className="font-mono font-semibold text-ink" style={{ fontSize: 13 }}>{s.value}</div><div className="font-mono text-ink-mute" style={{ fontSize: 10.5 }}>{s.note}</div></div>
          </div>
        ))}
        {!rows.length && <div className="border-t border-line px-3 py-5 text-center text-ink-mute" style={{ fontSize: 12.5 }}>{dt("Всё в пределах норм", "Everything is within targets")}</div>}
      </div>
    </div>
  );
}

export function CountriesWidget({ scope, sales, narrow, onNarrow, onMarket }: {
  scope: CountrySample[]; sales: SalesState; narrow: string | null; onNarrow: (cc: string | null) => void; onMarket: () => void;
}) {
  const dt = useDt();
  const n = scope.reduce((s, c) => s + c.pizzerias.length, 0);
  const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  return (
    <div className={card}>
      <div className="overflow-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
            <tr><th className={th}>{dt("Страна", "Country")}</th><th className={th}>{dt("Пицц.", "Pizz.")}</th><th className={th}>{dt("РС", "Std")}</th><th className={th}>{dt("РКО", "CX")}</th><th className={th}>{dt("Инсп.", "Insp.")}</th><th className={th} title={dt("Выручка за последний закрытый месяц, € — данные «Анализа рынка»", "Revenue for the last closed month, € — Market analysis data")}>{dt("Продажи, мес.", "Sales, mo.")}</th></tr>
          </thead>
          <tbody>
            {scope.map((c) => {
              const s = sales.byCc[c.cc];
              return (
                <tr key={c.cc} onClick={() => onNarrow(narrow === c.cc ? null : c.cc)} aria-selected={narrow === c.cc}
                  className={`cursor-pointer hover:bg-surface-2 ${narrow === c.cc ? "bg-accent-soft" : ""}`}>
                  <td className={td}><span className="mr-1.5">{countryFlag(c.cc)}</span><span className="font-medium text-ink">{dt(countryName(c.cc), c.cc)}</span></td>
                  <td className={`${td} font-mono text-ink-soft`}>{c.pizzerias.length}</td>
                  <td className={td}><Cell v={c.rs} t={tone(c.rs, RS_NORM, 85)} /></td>
                  <td className={td}><Cell v={c.rko} t={tone(c.rko, RKO_NORM, RKO_WARN)} digits={1} /></td>
                  <td className={td}><Cell v={c.coll} t={tone(c.coll, COLL_NORM, 70)} /></td>
                  <td className={`${td} whitespace-nowrap font-mono text-ink`}>
                    {sales.loading ? "…" : s?.last != null ? fmtEur(s.last) : "—"}
                    {s?.deltaPct != null && <span className={`ml-1.5 ${s.deltaPct >= 0 ? "text-[var(--status-done)]" : "text-[var(--pri-high)]"}`} style={{ fontSize: 11 }}>{pct(s.deltaPct)}</span>}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-surface-2 font-semibold">
              <td className={td}>Σ {dt("по подборке", "selection")}</td><td className={`${td} font-mono`}>{n}</td>
              <td className={`${td} font-mono`}>{weighted(scope, (c) => c.rs)?.toFixed(1) ?? "—"}</td>
              <td className={`${td} font-mono`}>{weighted(scope, (c) => c.rko)?.toFixed(1) ?? "—"}</td>
              <td className={`${td} font-mono`}>{weighted(scope, (c) => c.coll)?.toFixed(0) ?? "—"}%</td><td className={td} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2" style={{ fontSize: 12 }}>
        <span className="text-ink-mute">{dt("Клик по стране — сузить главную", "Click a country to focus the page")}</span>
        <button type="button" onClick={onMarket} className="font-medium text-primary hover:underline">{dt("Анализ рынка →", "Market analysis →")}</button>
      </div>
    </div>
  );
}
