"use client";
import { useMemo, useState } from "react";
import { useDt } from "../nav";
import { MiniSpark } from "./LineChart";
import { Delta, TONE_CELL, tone } from "./QualityWidgets";
import { fmtEur, type SalesState } from "./useCountrySales";
import { countryFlag, countryName } from "@/lib/countries";
import {
  RKO_DROP, RKO_NORM, RKO_WARN, RS_CRIT, RS_DROP, RS_NORM, RS_WARN, selectionMean,
  type CountryQuality, type Pizzeria,
} from "@/lib/homeQuality";

// Таблицы главной: все пиццерии подборки, «Куда смотреть» (сигналы по порогам) и «Мои страны».
// Баллы — настоящие (GET /quality); тип проверки, отчёты гостей и собираемость сняты: источника нет.

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

type PzFilter = "all" | "crit" | "rko" | "drop" | "missed";
const rsChange = (p: Pizzeria) => (p.rs != null && p.rsPrev != null ? p.rs - p.rsPrev : null);
const rkoChange = (p: Pizzeria) => (p.rko != null && p.rkoPrev != null ? p.rko - p.rkoPrev : null);
const PZ_FILTERS: Record<PzFilter, (p: Pizzeria) => boolean> = {
  all: () => true,
  crit: (p) => p.rs != null && p.rs < RS_CRIT,
  rko: (p) => p.rko != null && p.rko < RKO_WARN,
  drop: (p) => (rsChange(p) ?? 0) <= -RS_DROP || (rkoChange(p) ?? 0) <= -RKO_DROP,
  missed: (p) => p.rsMissed || p.rkoMissed,
};

export function PizzeriasWidget({ scope }: { scope: CountryQuality[] }) {
  const dt = useDt();
  const [f, setF] = useState<PzFilter>("all");
  const all = useMemo(() => scope.flatMap((c) => c.pizzerias).sort((a, b) => (a.rs ?? 101) - (b.rs ?? 101)), [scope]);
  const labels: Record<PzFilter, string> = {
    all: dt("Все", "All"), crit: dt(`РС ниже ${RS_CRIT}`, `Standards <${RS_CRIT}`), rko: dt("РКО ниже нормы", "CX below target"),
    drop: dt("Падение", "Dropping"), missed: dt("Без оценки", "Not rated"),
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
              <th className={`${th} max-[900px]:hidden`}>{dt("6 волн", "6 waves")}</th><th className={th}>{dt("РКО", "CX")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.key} className="hover:bg-surface-2">
                <td className={td}><span className="font-medium text-ink">{p.name}</span> <span className="ml-1 text-ink-mute" style={{ fontSize: 11 }}>{countryFlag(p.cc)}</span></td>
                <td className={td}><Cell v={p.rs} t={tone(p.rs, RS_NORM, RS_CRIT)} /> <Delta v={rsChange(p)} digits={0} small /></td>
                <td className={`${td} max-[900px]:hidden`}><MiniSpark values={p.rsHist} /></td>
                <td className={td}><Cell v={p.rko} t={tone(p.rko, RKO_NORM, RKO_WARN)} digits={1} /> <Delta v={rkoChange(p)} small /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className={`${td} py-5 text-center text-ink-mute`}>{dt("Таких пиццерий нет", "No pizzerias here")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Signal = { key: string; area: "crit" | "rs" | "rko"; title: string; text: string; value: string; note: string };

/** Сигналы по порогам: пиццерии в критической зоне РС, резкое падение РКО, страны ниже нормы. */
function signalsOf(scope: CountryQuality[], dt: (ru: string, en: string) => string): Signal[] {
  const out: Signal[] = [];
  for (const c of scope) {
    for (const p of c.pizzerias) {
      if (p.rs != null && p.rs < RS_CRIT) {
        out.push({ key: `c${p.key}`, area: "crit", title: p.name, text: dt(`РС в критической зоне (ниже ${RS_CRIT})`, `Standards in the critical zone (<${RS_CRIT})`), value: String(p.rs), note: p.rsPrev == null ? "" : dt(`было ${p.rsPrev}`, `was ${p.rsPrev}`) });
      }
      const drop = rkoChange(p);
      if (p.rko != null && drop != null && drop <= -RKO_DROP) {
        out.push({ key: `k${p.key}`, area: "rko", title: p.name, text: dt("РКО резко упал за неделю", "CX dropped sharply this week"), value: p.rko.toFixed(1), note: drop.toFixed(1) });
      }
    }
    const country = dt(countryName(c.cc), c.cc);
    if (c.rs != null && c.rs < RS_NORM) {
      out.push({ key: `s${c.cc}`, area: "rs", title: country, text: dt(`Средний РС страны ниже нормы ${RS_NORM}`, `Country standards average below ${RS_NORM}`), value: c.rs.toFixed(1), note: dt(`норма ${RS_NORM}`, `target ${RS_NORM}`) });
    }
    if (c.rko != null && c.rko < RKO_NORM) {
      out.push({ key: `n${c.cc}`, area: "rko", title: country, text: dt(`Средний РКО страны ниже нормы ${RKO_NORM}`, `Country CX average below ${RKO_NORM}`), value: c.rko.toFixed(1), note: dt(`норма ${RKO_NORM}`, `target ${RKO_NORM}`) });
    }
  }
  const order = { crit: 0, rko: 1, rs: 2 };
  return out.sort((a, b) => order[a.area] - order[b.area]);
}

export function AttentionWidget({ scope }: { scope: CountryQuality[] }) {
  const dt = useDt();
  const [f, setF] = useState<"all" | Signal["area"]>("all");
  const signals = useMemo(() => signalsOf(scope, dt), [scope, dt]);
  const names = { all: dt("Все", "All"), crit: dt("Критично", "Critical"), rs: dt("РС", "Standards"), rko: dt("РКО", "CX") };
  const tabs = (["all", "crit", "rs", "rko"] as const).map((k) => [k, names[k], k === "all" ? signals.length : signals.filter((s) => s.area === k).length] as ["all" | Signal["area"], string, number]);
  const rows = signals.filter((s) => f === "all" || s.area === f).slice(0, 8);
  const icon = { crit: ["!", "bad"], rs: ["◔", "warn"], rko: ["↓", "warn"] } as const;
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
  scope: CountryQuality[]; sales: SalesState; narrow: string | null; onNarrow: (cc: string | null) => void; onMarket: () => void;
}) {
  const dt = useDt();
  const n = scope.reduce((s, c) => s + c.pizzerias.length, 0);
  const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  return (
    <div className={card}>
      <div className="overflow-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
            <tr><th className={th}>{dt("Страна", "Country")}</th><th className={th}>{dt("Пицц.", "Pizz.")}</th><th className={th}>{dt("РС", "Std")}</th><th className={th}>{dt("РКО", "CX")}</th><th className={th} title={dt("Выручка за последний закрытый месяц, € — данные «Анализа рынка»", "Revenue for the last closed month, € — Market analysis data")}>{dt("Продажи, мес.", "Sales, mo.")}</th></tr>
          </thead>
          <tbody>
            {scope.map((c) => {
              const s = sales.byCc[c.cc];
              return (
                <tr key={c.cc} onClick={() => onNarrow(narrow === c.cc ? null : c.cc)} aria-selected={narrow === c.cc}
                  className={`cursor-pointer hover:bg-surface-2 ${narrow === c.cc ? "bg-accent-soft" : ""}`}>
                  <td className={td}><span className="mr-1.5">{countryFlag(c.cc)}</span><span className="font-medium text-ink">{dt(countryName(c.cc), c.cc)}</span></td>
                  <td className={`${td} font-mono text-ink-soft`}>{c.pizzerias.length}</td>
                  <td className={td}><Cell v={c.rs} t={tone(c.rs, RS_NORM, RS_WARN)} digits={1} /></td>
                  <td className={td}><Cell v={c.rko} t={tone(c.rko, RKO_NORM, RKO_WARN)} digits={1} /></td>
                  <td className={`${td} whitespace-nowrap font-mono text-ink`}>
                    {sales.loading ? "…" : s?.last != null ? fmtEur(s.last) : "—"}
                    {s?.deltaPct != null && <span className={`ml-1.5 ${s.deltaPct >= 0 ? "text-[var(--status-done)]" : "text-[var(--pri-high)]"}`} style={{ fontSize: 11 }}>{pct(s.deltaPct)}</span>}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-surface-2 font-semibold">
              <td className={td}>Σ {dt("по подборке", "selection")}</td><td className={`${td} font-mono`}>{n}</td>
              <td className={`${td} font-mono`}>{selectionMean(scope, (p) => p.rs)?.toFixed(1) ?? "—"}</td>
              <td className={`${td} font-mono`}>{selectionMean(scope, (p) => p.rko)?.toFixed(1) ?? "—"}</td>
              <td className={td} />
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
