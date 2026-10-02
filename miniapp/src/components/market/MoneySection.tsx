"use client";
// «Деньги» эталона: таблица .fin (сеть/юрлицо, выручка по годам в € млн, спарклайн, CAGR от
// первой выручки, сотрудники, точки, € млн на точку, доля от лидера) и карточки .facts под ней.
// Строки и карточки — из ручной части (money_rows, market_facts); без неё — все юрлица с
// отчётностью по выручке последнего года и рыночные факты (topic market).
import { useMemo } from "react";
import type { MarketBundle, MarketCompany, MarketFinancial } from "@/types";
import { cagr, factCards } from "@/lib/marketInsights";
import { fmtMln, isDerived, moneyYears, pickMoneyRows, sparkPoints } from "@/lib/marketMoney";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { revenuePerUnit } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { intFmt, RefSection, useEditorial } from "./ref";
import { firstUrl, SourceCaption, sourceLabel } from "./ui";

const FACTS = 5;
// Правило эталона: на странице нет прибыли и убытков — ни в таблице, ни в фактах.
const PROFIT = /profit|loss|dobit|gubit|прибыл|убыт/i;

type Row = { key: string; name: string; company: MarketCompany; units: number | null; perUnit: number | null };
type Fact = { big: string; text: string; source: string | null; href: string | null };

function Spark({ rev }: { rev: Array<number | null> }) {
  const pts = sparkPoints(rev);
  if (!pts.length) return null;
  const [lx, ly] = pts.at(-1)!;
  return (
    <svg width="80" height="22" viewBox="-2 -2 84 26" aria-hidden>
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" points={pts.map(([x, y]) => `${x},${y}`).join(" ")} />
      <circle cx={lx} cy={ly} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

export function MoneySection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const ed = useEditorial(bundle);
  const now = useMemo(() => new Date(), []);
  const years = useMemo(() => moneyYears(bundle.financials, now.getFullYear()), [bundle.financials, now]);
  const last = years.at(-1) ?? null;
  const byCo = useMemo(() => {
    const m = new Map<string, Map<number, MarketFinancial>>();
    for (const f of bundle.financials) {
      if (!m.has(f.company_id)) m.set(f.company_id, new Map());
      m.get(f.company_id)!.set(f.year, f);
    }
    return m;
  }, [bundle.financials]);
  const lastRev = (id: string) => (last !== null ? byCo.get(id)?.get(last)?.revenue_eur ?? null : null);

  const rows = useMemo<Row[]>(() => {
    if (last === null) return [];
    const chainName = new Map(bundle.chains.map((c) => [c.key, c.name]));
    const revOf = (id: string) => byCo.get(id)?.get(last)?.revenue_eur ?? null;
    // Ручные строки эталона: точки — живые на конец года по ключам строки, € млн / точка —
    // выручка последнего года на это число (грубая оценка, как в подзаголовке эталона).
    const picked = pickMoneyRows(ed.moneyRows, bundle.companies, (k) => (k ? chainName.get(k) ?? null : null), (id) => byCo.has(id));
    if (picked.length) {
      return picked.map(({ company, name, chains }) => {
        const units = chains ? aliveAtYearEnd(bundle.locations.filter((l) => chains.includes(l.chain_key)), last) : null;
        const rev = revOf(company.id);
        return { key: company.id, name, company, units, perUnit: units && rev ? rev / units : null };
      });
    }
    // Без ручной части — все юрлица с отчётностью, по выручке последнего года.
    return bundle.companies
      .filter((c) => byCo.has(c.id))
      .sort((a, b) => (revOf(b.id) ?? 0) - (revOf(a.id) ?? 0))
      .map((co) => {
        const chainLocs = bundle.locations.filter((l) => l.chain_key === co.chain_key);
        // Сеть с несколькими юрлицами (два франчайзи одной сети): точки и выручка на точку —
        // только у единственного оператора, иначе цифра ложная.
        const sole = co.chain_key !== null && bundle.companies.filter((c) => c.chain_key === co.chain_key).length === 1;
        const lastF = byCo.get(co.id)?.get(last);
        const units = sole ? aliveAtYearEnd(chainLocs, last) || null : null;
        return {
          key: co.id,
          name: (co.chain_key ? chainName.get(co.chain_key) : null) ?? co.name,
          company: co,
          units,
          // Без дат открытия месяцы работы не сосчитать — тогда как эталон: выручка на точки конца года.
          perUnit: sole && lastF ? revenuePerUnit(lastF, chainLocs) ?? (units && lastF.revenue_eur ? lastF.revenue_eur / units : null) : null,
        };
      });
  }, [ed.moneyRows, bundle.companies, bundle.chains, bundle.locations, byCo, last]);

  const facts = useMemo<Fact[]>(() => {
    if (ed.marketFacts.length) return ed.marketFacts.map((f) => ({ ...f, href: null }));
    return factCards(bundle.facts.filter((f) => f.topic === "market" && !PROFIT.test(`${f.value} ${f.text}`)), now, ru)
      .slice(0, FACTS)
      .map((c) => ({
        big: c.head,
        text: c.more ? `${c.more}. ${c.text}` : c.text,
        source: [c.date, sourceLabel(c.source)].filter(Boolean).join(" · ") || null,
        href: firstUrl(c.source),
      }));
  }, [ed.marketFacts, bundle.facts, now, ru]);

  const blocked = bundle.sources.find((s) => s.feeds === "financials" && (s.mode === "blocked" || s.reason));
  const leader = Math.max(0, ...rows.map((r) => lastRev(r.company.id) ?? 0));
  const yy = (y: number | null) => String(y ?? "").slice(2);
  const lede = ed.texts.money ?? dt(
    `Годовая отчётность юрлиц из реестров и ручной заливки. Звёздочка — значение пересчитано из годового прироста. Выручка на точку — грубая оценка: выручка ${last ?? ""} делится на число точек на конец ${last ?? ""}.`,
    `Annual company filings from registries and manual uploads. Asterisk — derived from year-on-year growth. Revenue per location is a rough estimate: ${last ?? ""} revenue divided by locations at the end of ${last ?? ""}.`,
  );
  const dash = <span className="muted">—</span>;

  return (
    <RefSection id="money" eyebrow={dt("Деньги", "Money")} title={dt("Выручки операторов, € млн", "Operators' revenue, € m")} lede={lede}>
      {!rows.length
        ? <p className="muted">{blocked?.reason ? dt(`Нет данных: ${blocked.reason}`, `No data: ${blocked.reason}`) : dt("Нет данных по юрлицам.", "No company filings yet.")}</p>
        : (
          <div className="panel scroll">
            <table className="fin">
              <thead>
                <tr>
                  <th>{dt("Сеть / юрлицо", "Chain / company")}</th>
                  {years.map((y) => <th key={y} className="r">{y}</th>)}
                  <th>{dt("Динамика", "Trend")}</th>
                  <th className="r">CAGR {yy(years[0])}–{yy(last)}</th>
                  <th className="r">{dt(`Сотр. ${yy(last)}`, `Staff ${yy(last)}`)}</th>
                  <th className="r">{dt("Точек", "Units")}</th>
                  <th className="r">{dt("€ млн / точка", "€ m / unit")}</th>
                  <th style={{ minWidth: 140 }}>{dt(`Доля от лидера, ${last}`, `Share of leader, ${last}`)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, name, company, units, perUnit }) => {
                  const fy = byCo.get(company.id)!;
                  const rev = years.map((y) => fy.get(y)?.revenue_eur ?? null);
                  const lastV = rev.at(-1) ?? null;
                  // Рост в год без разгонной базы (меньше 10% последнего года): у эталона такой базы
                  // в таблице не было, а у нас годы до открытия сети приходят из второго списка снимка.
                  const growth = lastV ? cagr(years.map((y, i) => [y, rev[i]] as [number, number | null])) : null;
                  const staff = last !== null ? fy.get(last)?.employees ?? null : null;
                  return (
                    <tr key={key}>
                      <td className="co">
                        <b>{name}</b>
                        <br />
                        <span className="muted">{[company.name === name ? null : company.name, company.reg_id && [ed.texts.reg_id_label, company.reg_id].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</span>
                      </td>
                      {years.map((y, i) => {
                        const v = fmtMln(rev[i], ru);
                        return <td key={y} className="r">{v ?? dash}{v && last !== null && isDerived(fy.get(y), last) ? "*" : ""}</td>;
                      })}
                      <td><Spark rev={rev} /></td>
                      <td className="r">{growth === null ? "—" : `${String(growth).replace("-", "−")}%`}</td>
                      <td className="r">{staff ? intFmt(staff, ru) : "—"}</td>
                      <td className="r">{units ?? "—"}</td>
                      <td className="r">{perUnit !== null ? fmtMln(perUnit, ru) : "—"}</td>
                      <td><div className="hbar" style={{ width: `${lastV && leader ? Math.max(1, (lastV / leader) * 100) : 0}%` }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {facts.length > 0 && (
        <div className="facts">
          {facts.map((f, i) => (
            <div key={i} className="panel fact">
              <b>{f.big}</b>
              <span>{f.text}</span>
              {f.source && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {f.href ? <a href={f.href} target="_blank" rel="noopener noreferrer">{f.source}</a> : f.source}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <SourceCaption bundle={bundle} feeds={ed.moneyRows.length || ed.marketFacts.length ? ["financials", "facts", "editorial"] : ["financials", "facts"]} />
    </RefSection>
  );
}
