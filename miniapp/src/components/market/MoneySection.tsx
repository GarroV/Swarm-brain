"use client";
// Выручки операторов по образцу референса: строка на юрлицо, выручка по годам в € млн,
// спарклайн, среднегодовой рост, сотрудники, точки, выручка на точку и доля от лидера.
// Под таблицей — рыночные цифры из фактов (topic market). Звёздочка — значение не
// проверено; статус проверки у каждой цифры приходит из базы.
import { useMemo } from "react";
import type { MarketBundle, MarketFinancial } from "@/types";
import { cagr, factCards } from "@/lib/marketInsights";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { revenuePerUnit } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { Empty, FactTile, mono, ScrollX, Section, SourceCaption } from "./ui";

const YEARS = 5;
const FACTS = 4;
// Правило эталона: на странице нет прибыли и убытков — ни в таблице, ни в фактах.
const PROFIT = /profit|loss|dobit|gubit|прибыл|убыт/i;
const SPARK = { w: 72, h: 22 };

// Меньше 5 тыс. евро в «€ млн» округлилось бы в «0.00» — это не ноль, пишем «<0,01».
const mln = (v: number | null, ru: boolean) => {
  if (v === null) return "—";
  const m = v / 1e6;
  const s = Math.abs(m) > 0 && Math.abs(m) < 0.005 ? "<0.01" : Math.abs(m) >= 10 ? m.toFixed(1) : m.toFixed(2);
  return ru ? s.replace(".", ",") : s;
};

function Spark({ values }: { values: Array<number | null> }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p[1])), min = Math.min(...pts.map((p) => p[1]));
  const x = (i: number) => 2 + (i / (values.length - 1)) * (SPARK.w - 4);
  const y = (v: number) => SPARK.h - 3 - ((v - min) / (max - min || 1)) * (SPARK.h - 6);
  const [li, lv] = pts.at(-1)!;
  return (
    <svg width={SPARK.w} height={SPARK.h} aria-hidden>
      <polyline points={pts.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="var(--accent-ink)" strokeWidth={1.4} />
      <circle cx={x(li)} cy={y(lv)} r={2.2} fill="var(--accent-ink)" />
    </svg>
  );
}

export function MoneySection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const now = useMemo(() => new Date(), []);
  const years = useMemo(() => [...new Set(bundle.financials.map((f) => f.year))].sort((a, b) => a - b).slice(-YEARS), [bundle.financials]);
  const last = years.at(-1);
  const byCo = useMemo(() => {
    const m = new Map<string, Map<number, MarketFinancial>>();
    for (const f of bundle.financials) {
      if (!m.has(f.company_id)) m.set(f.company_id, new Map());
      m.get(f.company_id)!.set(f.year, f);
    }
    return m;
  }, [bundle.financials]);
  const chainOf = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c])), [bundle.chains]);
  const companies = useMemo(
    () => bundle.companies.filter((c) => byCo.has(c.id)).sort((a, b) => (byCo.get(b.id)?.get(last!)?.revenue_eur ?? 0) - (byCo.get(a.id)?.get(last!)?.revenue_eur ?? 0)),
    [bundle.companies, byCo, last],
  );
  const leader = companies.length && last ? byCo.get(companies[0].id)?.get(last)?.revenue_eur ?? null : null;
  const facts = useMemo(
    () => factCards(bundle.facts.filter((f) => f.topic === "market" && !PROFIT.test(`${f.value} ${f.text}`)), now, ru).slice(0, FACTS),
    [bundle.facts, now, ru],
  );
  const blocked = bundle.sources.find((s) => s.feeds === "financials" && (s.mode === "blocked" || s.reason));
  const th = "py-2 pr-3 font-semibold uppercase tracking-wide text-accent-ink";

  return (
    <Section title={dt("Выручки операторов, € млн", "Operators' revenue, € m")}>
      <p className="-mt-1 mb-3 max-w-[680px] text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          `Годовая отчётность юрлиц из реестров и ручной заливки. Звёздочка — значение не проверено. Выручка на точку — выручка ${last ?? ""} на число точек сети на конец года; если у большинства точек нет даты открытия, не считается.`,
          `Annual company filings from registries and manual uploads. Asterisk — unverified. Revenue per location — ${last ?? ""} revenue over the chain's locations at year end; not computed when most locations have no opening date.`,
        )}
      </p>
      {!companies.length
        ? <Empty text={blocked?.reason ? dt(`Нет данных: ${blocked.reason}`, `No data: ${blocked.reason}`) : dt("Нет данных по юрлицам.", "No company filings yet.")} />
        : (
          <ScrollX>
            <table className="w-full min-w-[900px] border-collapse" style={{ fontSize: 12.5 }}>
              <thead>
                <tr className="text-left" style={{ fontSize: 10.5 }}>
                  <th className={`${th} pl-3`}>{dt("Сеть / юрлицо", "Chain / company")}</th>
                  {years.map((y) => <th key={y} className={`${th} text-right`} style={mono}>{y}</th>)}
                  <th className={th}>{dt("Динамика", "Trend")}</th>
                  <th className={`${th} text-right`}>{dt(`Рост в год ${String(years[0]).slice(2)}–${String(last).slice(2)}`, `CAGR ${String(years[0]).slice(2)}–${String(last).slice(2)}`)}</th>
                  <th className={`${th} text-right`}>{dt(`Сотр. ${String(last).slice(2)}`, `Staff ${String(last).slice(2)}`)}</th>
                  <th className={`${th} text-right`}>{dt("Точек", "Units")}</th>
                  <th className={`${th} text-right`}>{dt("€ млн / точка", "€ m / unit")}</th>
                  <th className={`${th} pr-3`}>{dt(`Доля от лидера, ${last}`, `Share of leader, ${last}`)}</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((co) => {
                  const ch = co.chain_key ? chainOf.get(co.chain_key) : undefined;
                  const fy = byCo.get(co.id)!;
                  const series = years.map((y) => fy.get(y)?.revenue_eur ?? null);
                  const lastF = last ? fy.get(last) : undefined;
                  const chainLocs = bundle.locations.filter((l) => l.chain_key === co.chain_key);
                  // Сеть с несколькими юрлицами (два франчайзи Dodo в Румынии): точки и выручка на
                  // точку — только у единственного оператора, иначе цифра ложная.
                  const sole = co.chain_key !== null && bundle.companies.filter((c) => c.chain_key === co.chain_key).length === 1;
                  const units = sole && last ? aliveAtYearEnd(chainLocs, last) : null;
                  const perUnit = sole && lastF ? revenuePerUnit(lastF, chainLocs) : null;
                  const growth = cagr(years.map((y, i) => [y, series[i]]));
                  const share = leader && lastF?.revenue_eur ? lastF.revenue_eur / leader : 0;
                  return (
                    <tr key={co.id} className="border-t border-line align-top">
                      <td className="py-2 pl-3 pr-3">
                        <div className="font-semibold text-ink">{ch?.name ?? co.name}</div>
                        <div className="text-ink-mute" style={{ fontSize: 11.5 }}>{[co.name, co.reg_id].filter(Boolean).join(" · ")}</div>
                      </td>
                      {years.map((y) => {
                        const f = fy.get(y);
                        const unverified = f?.verification === "unverified";
                        return (
                          <td key={y} className="py-2 pr-3 text-right text-ink" style={mono} title={f?.note ?? f?.source ?? undefined}>
                            {f ? `${mln(f.revenue_eur, ru)}${unverified ? "*" : ""}` : <span className="text-ink-mute">—</span>}
                          </td>
                        );
                      })}
                      <td className="py-1.5 pr-3"><Spark values={series} /></td>
                      <td className="py-2 pr-3 text-right text-ink" style={mono}>{growth !== null ? `${growth}%` : "—"}</td>
                      <td className="py-2 pr-3 text-right text-ink" style={mono}>{lastF?.employees?.toLocaleString(ru ? "ru-RU" : "en-US") ?? "—"}</td>
                      <td className="py-2 pr-3 text-right text-ink" style={mono}>{units || "—"}</td>
                      <td className="py-2 pr-3 text-right text-ink" style={mono}>{perUnit !== null ? mln(perUnit, ru) : "—"}</td>
                      <td className="py-2.5 pr-3">
                        <div className="h-2 rounded-sm" style={{ width: `${Math.max(share * 100, share ? 1 : 0)}%`, background: "var(--mkt-s2)" }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        )}
      {facts.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((c, i) => <FactTile key={i} card={c} />)}
        </div>
      )}
      <SourceCaption bundle={bundle} feeds="financials" />
    </Section>
  );
}
