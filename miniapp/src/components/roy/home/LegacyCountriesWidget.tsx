"use client";
import { Fragment, useMemo, useState } from "react";
import { useDt } from "../nav";
import { Delta, tone } from "./QualityWidgets";
import { card, Cell, chevron, rkoChange, revenueCell, rsChange, salesHint, td, th } from "./TableWidgets";
import { fmtEur, type SalesState } from "./useCountrySales";
import { useMaps } from "./useMaps";
import { countryFlag, countryName } from "@/lib/countries";
import { countryMaps, mapsByUnit, unitChange, type UnitMaps } from "@/lib/homeMaps";
import { unitRevenue } from "@/lib/homeSales";
import {
  RKO_NORM, RKO_WARN, RS_CRIT, RS_NORM, RS_WARN, selectionMean,
  type CountryQuality,
} from "@/lib/homeQuality";

// «Мои страны» в прежнем виде (как на main до экрана «А», решение владельца 10.11.2026): цифры в цветных
// плашках, «Анализ рынка →» внизу. Показывается, пока флаг lib/homeFlag.ts выключен; при раскатке экрана
// «А» на всех файл удаляется вместе с флагом.

function LegacyMapCell({ s, digits = 2 }: { s: { avg: number | null } | null; digits?: number }) {
  if (s?.avg == null) return <span className="text-ink-mute">—</span>;
  return <span className="font-mono text-ink">{s.avg.toFixed(digits)}<span className="text-[#E8A400]"> ★</span></span>;
}


/** Пиццерии раскрытой страны: РС, РКО и оценки карт со стрелкой изменения. Сначала худшие по РС. */
function LegacyCountryPizzerias({ c, units, sales }: { c: CountryQuality; units: Map<string, UnitMaps>; sales: SalesState }) {
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
            <td className={`${td} whitespace-nowrap`}><Cell v={p.rs} t={tone(p.rs, RS_NORM, RS_CRIT)} /> <Delta v={rsChange(p)} digits={0} small /></td>
            <td className={`${td} whitespace-nowrap`}><Cell v={p.rko} t={tone(p.rko, RKO_NORM, RKO_WARN)} digits={1} /> <Delta v={rkoChange(p)} small /></td>
            <td className={`${td} whitespace-nowrap`}><LegacyMapCell s={m?.google ?? null} /> <Delta v={unitChange(m?.google ?? null)} digits={2} small /></td>
            <td className={`${td} whitespace-nowrap`}><LegacyMapCell s={m?.yandex ?? null} /> <Delta v={unitChange(m?.yandex ?? null)} digits={2} small /></td>
            <td className={`${td} whitespace-nowrap font-mono`}>
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
export function LegacyCountriesWidget({ scope, sales, narrow, onNarrow, onMarket }: {
  scope: CountryQuality[]; sales: SalesState; narrow: string | null; onNarrow: (cc: string | null) => void; onMarket: () => void;
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
    <th className={th} title={dt("Средняя оценка на картах и изменение за 30 дней", "Average map rating and 30-day change")}>{name}</th>
  );
  return (
    <div className={card}>
      <div className="overflow-auto min-[1100px]:min-h-0 min-[1100px]:flex-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
            <tr>
              <th className={th}>{dt("Страна", "Country")}</th><th className={th}>{dt("Пицц.", "Pizz.")}</th>
              <th className={th}>{dt("РС", "Std")}</th><th className={th}>{dt("РКО", "CX")}</th>
              {mapHead("Google")}{mapHead(dt("Яндекс", "Yandex"))}
              <th className={th} title={salesHint(dt, sales.unitSales?.loaded)}>{dt("Продажи", "Sales")}</th>
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
                    <td className={`${td} font-mono text-ink-soft`}>{c.pizzerias.length}</td>
                    <td className={`${td} whitespace-nowrap`}><Cell v={c.rs} t={tone(c.rs, RS_NORM, RS_WARN)} digits={1} /> <Delta v={change(c.rs, c.rsPrev)} small /></td>
                    <td className={`${td} whitespace-nowrap`}><Cell v={c.rko} t={tone(c.rko, RKO_NORM, RKO_WARN)} digits={1} /> <Delta v={change(c.rko, c.rkoPrev)} small /></td>
                    <td className={`${td} whitespace-nowrap`}>{maps.loading ? "…" : <><LegacyMapCell s={m?.maps.google ?? null} /> <Delta v={m?.maps.google.delta ?? null} digits={2} small /></>}</td>
                    <td className={`${td} whitespace-nowrap`}>{maps.loading ? "…" : <><LegacyMapCell s={m?.maps.yandex ?? null} /> <Delta v={m?.maps.yandex.delta ?? null} digits={2} small /></>}</td>
                    <td className={`${td} whitespace-nowrap font-mono text-ink`}>
                      {sales.loading ? "…" : s?.mtd ? fmtEur(s.mtd.revenue_eur) : "—"}
                    </td>
                  </tr>
                  {isOpen && <LegacyCountryPizzerias c={c} units={units} sales={sales} />}
                </Fragment>
              );
            })}
            <tr className="bg-surface-2 font-semibold">
              <td className={td}>Σ {dt("по подборке", "selection")}</td><td className={`${td} font-mono`}>{n}</td>
              <td className={`${td} font-mono`}>{selectionMean(scope, (p) => p.rs)?.toFixed(1) ?? "—"}</td>
              <td className={`${td} font-mono`}>{selectionMean(scope, (p) => p.rko)?.toFixed(1) ?? "—"}</td>
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
        <button type="button" onClick={onMarket} className="shrink-0 font-medium text-primary hover:underline">{dt("Анализ рынка →", "Market analysis →")}</button>
      </div>
    </div>
  );
}
