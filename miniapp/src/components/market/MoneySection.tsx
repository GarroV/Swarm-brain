"use client";
// Деньги: юрлица операторов × годы (выручка, прибыль, сотрудники) из реестров и ручной
// заливки, у пицца-сетей — выручка на точку. Статус проверки виден у каждой цифры.
import { useMemo } from "react";
import type { MarketBundle, MarketFinancial } from "@/types";
import { fmtEur, revenuePerUnit } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { Empty, mono, Section, SourceCaption } from "./ui";

export function MoneySection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const years = useMemo(() => [...new Set(bundle.financials.map((f) => f.year))].sort((a, b) => a - b).slice(-5), [bundle.financials]);
  const byCo = useMemo(() => {
    const m = new Map<string, Map<number, MarketFinancial>>();
    for (const f of bundle.financials) {
      if (!m.has(f.company_id)) m.set(f.company_id, new Map());
      m.get(f.company_id)!.set(f.year, f);
    }
    return m;
  }, [bundle.financials]);
  const chainName = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c])), [bundle.chains]);
  const companies = bundle.companies
    .filter((c) => byCo.has(c.id))
    .sort((a, b) => (byCo.get(b.id)?.get(years.at(-1)!)?.revenue_eur ?? 0) - (byCo.get(a.id)?.get(years.at(-1)!)?.revenue_eur ?? 0));

  const blocked = bundle.sources.find((s) => s.feeds === "financials" && (s.mode === "blocked" || s.reason));
  return (
    <Section title={dt("Финансы операторов", "Operators' financials")}>
      {!companies.length
        ? <Empty text={blocked?.reason ? dt(`Нет данных: ${blocked.reason}`, `No data: ${blocked.reason}`) : dt("Нет данных по юрлицам.", "No company filings yet.")} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse" style={{ fontSize: 12 }}>
              <thead>
                <tr className="text-left text-ink-mute">
                  <th className="py-1.5 pr-3 font-medium">{dt("Юрлицо", "Company")}</th>
                  {years.map((y) => <th key={y} className="py-1.5 pr-3 text-right font-medium" style={mono}>{y}</th>)}
                </tr>
              </thead>
              <tbody>
                {companies.map((co) => {
                  const ch = co.chain_key ? chainName.get(co.chain_key) : undefined;
                  const chainLocs = bundle.locations.filter((l) => l.chain_key === co.chain_key);
                  return (
                    <tr key={co.id} className="border-t border-line align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-ink">{co.name}</div>
                        <div className="text-ink-mute">{[ch?.name, co.reg_id].filter(Boolean).join(" · ")}</div>
                      </td>
                      {years.map((y) => {
                        const f = byCo.get(co.id)?.get(y);
                        if (!f) return <td key={y} className="py-2 pr-3 text-right text-ink-mute">—</td>;
                        // Сеть с несколькими юрлицами (два франчайзи Dodo в Румынии): выручка одного
                        // на все точки сети — ложная цифра, поэтому только у единственного оператора.
                        const soleOperator = bundle.companies.filter((c) => c.chain_key === co.chain_key).length === 1;
                        const perUnit = ch?.segment === "pizza" && soleOperator ? revenuePerUnit(f, chainLocs) : null;
                        const unverified = f.verification === "unverified";
                        return (
                          <td key={y} className="py-2 pr-3 text-right" style={mono} title={f.note ?? f.source ?? undefined}>
                            <div className={unverified ? "text-ink-soft italic" : "text-ink"}>
                              {fmtEur(f.revenue_eur)}{unverified ? "*" : ""}
                            </div>
                            <div className={f.net_profit_eur !== null && f.net_profit_eur < 0 ? "text-destructive" : "text-ink-mute"}>
                              {fmtEur(f.net_profit_eur)}
                            </div>
                            <div className="text-ink-mute">
                              {f.employees !== null ? `${f.employees} ${dt("чел.", "staff")}` : ""}
                              {perUnit !== null ? ` · ${fmtEur(perUnit)}/${dt("тчк", "unit")}` : ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-ink-mute" style={{ fontSize: 12 }}>
              {dt(
                "В ячейке: выручка, чистая прибыль, сотрудники; у пицца-сетей с одним оператором — выручка на точку, работавшую к концу года. * — не проверено.",
                "Per cell: revenue, net profit, staff; single-operator pizza chains also show revenue per unit open at year end. * — unverified.",
              )}
            </p>
          </div>
        )}
      <SourceCaption bundle={bundle} feeds="financials" />
    </Section>
  );
}
