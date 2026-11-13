"use client";
import { Fragment, useMemo, useState } from "react";
import { useDt } from "../nav";
import { MiniSpark } from "./LineChart";
import { Delta, TONE_CELL, tone } from "./QualityWidgets";
import { FILL } from "./blockFill";
import { fmtEur, type SalesState } from "./useCountrySales";
import { useMaps } from "./useMaps";
import { countryFlag, countryName } from "@/lib/countries";
import { countryMaps, mapsByUnit, unitChange, type UnitMaps } from "@/lib/homeMaps";
import { loadedLabel, unitRevenue } from "@/lib/homeSales";
import {
  RKO_DROP, RKO_NORM, RKO_WARN, RS_CRIT, RS_DROP, RS_NORM, RS_WARN, selectionMean,
  type CountryQuality, type Pizzeria,
} from "@/lib/homeQuality";

// Таблицы главной: все пиццерии подборки и «Мои страны» («Куда смотреть» снят 11.10.2026).
// Баллы — настоящие (GET /quality); тип проверки, отчёты гостей и собираемость сняты: источника нет.

// Карточка таблицы — колонка блока: шапка/вкладки на месте, строки прокручиваются внутри (sticky th).
export const card = `flex flex-col rounded-[12px] border border-line bg-surface min-[1100px]:overflow-hidden ${FILL}`;
export const th = "sticky top-0 bg-surface px-2.5 py-2 text-left font-semibold uppercase text-ink-mute";
export const td = "border-t border-line px-2.5 py-2";

// «Мои страны» (экран «А»): число моноширинным справа, изменение мелко рядом — зелёный ▲ / красный ▼ / серый 0.
// Цвет самого числа — только у тревожных значений (ниже нормы — янтарь, критично — красный).
const NUM_TONE: Record<ReturnType<typeof tone>, string> = { good: "text-ink", "": "text-ink-mute", warn: "text-[var(--pri-med)]", bad: "text-[var(--pri-high)]" };
const thR = `${th} text-right`;
const tdR = `${td} whitespace-nowrap text-right`;

function Num({ v, digits = 1, t = "good", change, changeDigits = digits }: { v: number | null; digits?: number; t?: ReturnType<typeof tone>; change?: number | null; changeDigits?: number }) {
  const dt = useDt();
  const loc = dt("ru-RU", "en-US");
  const fmt = (x: number, d: number) => x.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  const rounded = change == null ? null : Math.round(change * 10 ** changeDigits) / 10 ** changeDigits;
  const cls = rounded == null ? "" : rounded > 0 ? "text-[var(--status-done)]" : rounded < 0 ? "text-[var(--pri-high)]" : "text-ink-mute";
  return (
    <span className="font-mono">
      <span className={NUM_TONE[t]} style={{ fontSize: 13 }}>{v == null ? "—" : fmt(v, digits)}</span>
      {rounded != null && (
        <span className={`ml-1.5 ${cls}`} style={{ fontSize: 11 }}>{rounded > 0 ? "▲" : rounded < 0 ? "▼" : ""}{fmt(Math.abs(rounded), changeDigits)}</span>
      )}
    </span>
  );
}

export function Cell({ v, t, digits = 0 }: { v: number | null; t: ReturnType<typeof tone>; digits?: number }) {
  return <span className={`inline-block min-w-[38px] rounded-[6px] px-1.5 py-0.5 text-center font-mono ${TONE_CELL[t]}`} style={{ fontSize: 12 }}>{v == null ? "—" : v.toFixed(digits)}</span>;
}

function Tabs<K extends string>({ tabs, value, onChange }: { tabs: Array<[K, string, number]>; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pt-3" role="tablist">
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
export const rsChange = (p: Pizzeria) => (p.rs != null && p.rsPrev != null ? p.rs - p.rsPrev : null);
export const rkoChange = (p: Pizzeria) => (p.rko != null && p.rkoPrev != null ? p.rko - p.rkoPrev : null);
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
      <div className="mt-2 max-h-[520px] overflow-auto min-[1100px]:max-h-none min-[1100px]:min-h-0 min-[1100px]:flex-auto">
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

function MapCell({ s, change, digits = 1 }: { s: { avg: number | null } | null; change?: number | null; digits?: number }) {
  return <Num v={s?.avg ?? null} digits={digits} change={change} changeDigits={digits === 1 ? 1 : 2} />;
}

export const chevron = (open: boolean) => (
  <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className={`mr-1 inline-block shrink-0 text-ink-mute transition-transform ${open ? "rotate-90" : ""}`}>
    <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Выручка пиццерии: цифра из Dodo IS (через Децимус) или «—» с пояснением, что данных нет; не оценка и не подмена. */
export function revenueCell(v: number | null, dt: (ru: string, en: string) => string) {
  if (v == null) return <span className="text-ink-mute" title={dt("Нет данных Dodo IS по этой пиццерии", "No Dodo IS data for this pizzeria")}>—</span>;
  return <span className="text-ink-soft">{fmtEur(v)}</span>;
}

/** Подсказка колонки «Продажи»: откуда цифры и на какое время загружены. */
export function salesHint(dt: (ru: string, en: string) => string, loaded: Record<string, string> | undefined): string {
  const at = loadedLabel(loaded, dt("ru-RU", "en-GB"));
  return dt(
    `Выручка с 1-го числа текущего месяца, €. Для стран с подключённым Dodo IS — данные Dodo IS через DECIMUS, у страны сумма её пиццерий${at ? `; загружено: ${at}` : ""}. Для остальных стран — публичный API Dodo, только по стране, без разбивки по пиццериям.`,
    `Revenue since the 1st of the current month, €. For countries with Dodo IS connected — Dodo IS data via DECIMUS, the country shows the sum of its pizzerias${at ? `; loaded: ${at}` : ""}. For other countries — the public Dodo API, country total only, no per-pizzeria breakdown.`,
  );
}

/** Пиццерии раскрытой страны: РС, РКО и оценки карт со стрелкой изменения. Сначала худшие по РС. */
function CountryPizzerias({ c, units, sales }: { c: CountryQuality; units: Map<string, UnitMaps>; sales: SalesState }) {
  const dt = useDt();
  const rows = [...c.pizzerias].sort((a, b) => (a.rs ?? 101) - (b.rs ?? 101) || a.name.localeCompare(b.name));
  return (
    <>
      {rows.map((p) => {
        const m = units.get(p.key.toLowerCase());
        return (
          <tr key={p.key} className="bg-surface-2" style={{ fontSize: 12 }}>
            <td className={`${td} pl-8`}><span className="text-ink">{p.name}</span></td>
            <td className={td} />
            <td className={tdR}><Num v={p.rs} digits={0} t={tone(p.rs, RS_NORM, RS_CRIT)} change={rsChange(p)} /></td>
            <td className={tdR}><Num v={p.rko} digits={1} t={tone(p.rko, RKO_NORM, RKO_WARN)} change={rkoChange(p)} /></td>
            <td className={tdR}><MapCell s={m?.google ?? null} digits={2} change={unitChange(m?.google ?? null)} /></td>
            <td className={tdR}><MapCell s={m?.yandex ?? null} digits={2} change={unitChange(m?.yandex ?? null)} /></td>
            <td className={`${tdR} font-mono`}>
              {sales.loading ? "…" : revenueCell(unitRevenue(sales.unitSales, p.key), dt)}
            </td>
          </tr>
        );
      })}
      {!rows.length && <tr><td colSpan={7} className={`${td} pl-8 text-ink-mute`} style={{ fontSize: 12 }}>—</td></tr>}
    </>
  );
}

// «Мои страны» (владелец 11.10.2026): у РС и РКО страны — стрелка к прошлому периоду, рядом оценки
// Google и Яндекса за 30 дней (бывший виджет «Карты и отзывы»); строка страны раскрывается в её
// пиццерии с теми же колонками. Сузить главную до страны — отдельной кнопкой в строке.
export function CountriesWidget({ scope, sales, narrow, onNarrow }: {
  scope: CountryQuality[]; sales: SalesState; narrow: string | null; onNarrow: (cc: string | null) => void;
}) {
  const dt = useDt();
  const maps = useMaps();
  const units = useMemo(() => mapsByUnit(maps.data), [maps.data]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (cc: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(cc)) next.delete(cc); else next.add(cc);
    return next;
  });
  const n = scope.reduce((s, c) => s + c.pizzerias.length, 0);
  const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const change = (v: number | null, prev: number | null) => (v == null || prev == null ? null : v - prev);
  const mapHead = (name: string) => (
    <th className={thR} title={dt("Средняя оценка на картах и изменение за 30 дней", "Average map rating and 30-day change")}>{name}</th>
  );
  return (
    <div className={card}>
      <div className="overflow-auto min-[1100px]:min-h-0 min-[1100px]:flex-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
            <tr>
              <th className={th}>{dt("Страна", "Country")}</th><th className={thR}>{dt("Пицц.", "Pizz.")}</th>
              <th className={thR}>{dt("РС", "Std")}</th><th className={thR}>{dt("РКО", "CX")}</th>
              {mapHead("Google")}{mapHead(dt("Яндекс", "Yandex"))}
              <th className={thR} title={salesHint(dt, sales.unitSales?.loaded)}>{dt("Продажи", "Sales")}</th>
            </tr>
          </thead>
          <tbody>
            {scope.map((c) => {
              const s = sales.byCc[c.cc];
              const m = countryMaps(maps.data, c.cc);
              const isOpen = open.has(c.cc);
              return (
                <Fragment key={c.cc}>
                  <tr onClick={() => toggle(c.cc)} aria-expanded={isOpen}
                    className={`cursor-pointer hover:bg-surface-2 ${narrow === c.cc ? "bg-accent-soft" : ""}`}>
                    <td className={`${td} whitespace-nowrap`}>
                      {chevron(isOpen)}<span className="mr-1.5">{countryFlag(c.cc)}</span><span className="font-medium text-ink">{dt(countryName(c.cc), c.cc)}</span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); onNarrow(narrow === c.cc ? null : c.cc); }}
                        aria-pressed={narrow === c.cc}
                        title={narrow === c.cc ? dt("Показать все страны подборки", "Show all selected countries") : dt("Сузить главную до этой страны", "Focus the page on this country")}
                        className={`ml-2 rounded-full border px-1.5 py-px align-middle ${narrow === c.cc ? "border-primary text-primary" : "border-line-2 text-ink-mute hover:border-accent-line hover:text-primary"}`}
                        style={{ fontSize: 10.5 }}>
                        {narrow === c.cc ? dt("все", "all") : dt("только", "only")}
                      </button>
                    </td>
                    <td className={`${tdR} font-mono text-ink-soft`}>{c.pizzerias.length}</td>
                    <td className={tdR}><Num v={c.rs} t={tone(c.rs, RS_NORM, RS_WARN)} change={change(c.rs, c.rsPrev)} /></td>
                    <td className={tdR}><Num v={c.rko} digits={1} t={tone(c.rko, RKO_NORM, RKO_WARN)} change={change(c.rko, c.rkoPrev)} /></td>
                    <td className={tdR}>{maps.loading ? "…" : <MapCell s={m?.maps.google ?? null} change={m?.maps.google.delta ?? null} />}</td>
                    <td className={tdR}>{maps.loading ? "…" : <MapCell s={m?.maps.yandex ?? null} change={m?.maps.yandex.delta ?? null} />}</td>
                    <td className={`${tdR} font-mono text-ink`}>
                      {sales.loading ? "…" : s?.mtd ? fmtEur(s.mtd.revenue_eur) : "—"}
                    </td>
                  </tr>
                  {isOpen && <CountryPizzerias c={c} units={units} sales={sales} />}
                </Fragment>
              );
            })}
            <tr className="bg-surface-2 font-semibold">
              <td className={td}>Σ {dt("по подборке", "selection")}</td><td className={`${tdR} font-mono`}>{n}</td>
              <td className={`${tdR} font-mono`}>{selectionMean(scope, (p) => p.rs)?.toFixed(1) ?? "—"}</td>
              <td className={`${tdR} font-mono`}>{selectionMean(scope, (p) => p.rko)?.toFixed(1) ?? "—"}</td>
              <td className={td} /><td className={td} /><td className={td} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-3 py-2" style={{ fontSize: 12 }}>
        <span className="text-ink-mute">
          {maps.failed
            ? <>{dt("Оценки карт не загрузились.", "Couldn't load map ratings.")}{" "}<button type="button" onClick={maps.retry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button></>
            : dt("Клик по стране — её пиццерии; карты — изменение за 30 дней", "Click a country for its pizzerias; maps show the 30-day change")}
        </span>
      </div>
    </div>
  );
}
