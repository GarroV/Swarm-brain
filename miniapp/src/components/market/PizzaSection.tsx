"use client";
// Пицца-конкуренты по образцу эталона: таблица пицца-сетей (точки, вход, выручка по годам,
// выручка на пиццерию — без прибыли), столбцы выручки на пиццерию и матрица цен на пиццу
// ~30 см по каналам с ценой за 100 см². Всё из реестра точек, юрлиц и ручной заливки цен.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import { chainColors } from "@/lib/marketMap";
import { chainRevenue, userNote, yearOf } from "@/lib/marketInsights";
import { priceMatrix, type PizzaType } from "@/lib/marketPizza";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { revenuePerUnit } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { mono, ScrollX, Section, SourceCaption, useMoney } from "./ui";

const PIZZA: Record<PizzaType, [string, string]> = {
  margherita: ["Маргарита", "Margherita"],
  pepperoni: ["Пепперони / колбаса", "Pepperoni / sausage"],
  ham_mushroom: ["Капричоза", "Capricciosa"],
  premium: ["Премиум (4 сыра)", "Premium (4 cheese)"],
};
const CHANNEL: Record<string, [string, string]> = { site: ["сайт", "site"], wolt: ["Wolt", "Wolt"], glovo: ["Glovo", "Glovo"], other: ["другое", "other"] };
const FIN_YEARS = 2;

export function PizzaSection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const money = useMoney();
  const ru = useLang() === "ru";
  const dec = (v: number) => (ru ? v.toFixed(2).replace(".", ",") : v.toFixed(2));
  const now = useMemo(() => new Date(), []);
  const y = now.getFullYear();
  const colors = useMemo(() => chainColors(bundle.chains, bundle.locations), [bundle.chains, bundle.locations]);
  const name = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const pizza = useMemo(
    () =>
      bundle.chains
        .filter((c) => c.segment === "pizza")
        .map((c) => {
          const locs = bundle.locations.filter((l) => l.chain_key === c.key);
          const first = locs.map((l) => l.opened).filter((o): o is string => !!o).sort()[0] ?? null;
          return { c, locs, units: aliveAtYearEnd(locs, y, y), paused: locs.filter((l) => l.status === "paused").length, entry: c.first_entry ?? first };
        })
        .filter((x) => x.units > 0 || x.locs.some((l) => l.status === "planned"))
        .sort((a, b) => b.units - a.units),
    [bundle.chains, bundle.locations, y],
  );
  const finYears = useMemo(() => [...new Set(bundle.financials.filter((f) => f.revenue_eur !== null).map((f) => f.year))].sort().slice(-FIN_YEARS), [bundle.financials]);
  const revByYear = useMemo(() => new Map(finYears.map((fy) => [fy, chainRevenue(bundle, fy)])), [bundle, finYears]);
  const matrix = useMemo(() => priceMatrix(bundle.prices, pizza.map((p) => p.c.key)), [bundle.prices, pizza]);
  if (!pizza.length) return null;

  const perUnit = (key: string, fy: number) => {
    const rev = revByYear.get(fy)?.get(key);
    return rev === undefined ? null : revenuePerUnit({ revenue_eur: rev, year: fy }, pizza.find((p) => p.c.key === key)!.locs);
  };
  const bars = pizza.flatMap((p) => finYears.map((fy) => ({ key: p.c.key, fy, v: perUnit(p.c.key, fy) }))).filter((b) => b.v !== null) as Array<{ key: string; fy: number; v: number }>;
  const barMax = Math.max(1, ...bars.map((b) => b.v));
  const pricesOn = bundle.prices.map((p) => p.seen_on).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const minPer100 = matrix.rows.map((r) => Math.min(...r.cells.map((c) => c?.per100 ?? Infinity)));
  const th = "py-2 pr-3 font-semibold uppercase tracking-wide text-accent-ink";

  return (
    <Section title={dt("Пицца-конкуренты", "Pizza competitors")}>
      <p className="-mt-1 mb-3 max-w-[680px] text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          "Выручка — из годовой отчётности юрлиц. Выручка на пиццерию — выручка за год на сумму месяцев работы всех точек × 12; месяц открытия не считается.",
          "Revenue is from annual company filings. Revenue per pizzeria is yearly revenue over the summed months of operation of all locations × 12; the opening month is excluded.",
        )}
      </p>
      <ScrollX>
        <table className="w-full min-w-[720px] border-collapse" style={{ fontSize: 12.5 }}>
          <thead>
            <tr className="text-left" style={{ fontSize: 10.5 }}>
              <th className={`${th} pl-3`}>{dt("Сеть", "Chain")}</th>
              <th className={`${th} text-right`}>{dt("Точек", "Units")}</th>
              <th className={th}>{dt("Вход", "Entry")}</th>
              {finYears.map((fy) => <th key={fy} className={`${th} text-right`}>{dt(`Выручка ${fy}`, `Revenue ${fy}`)}</th>)}
              {finYears.length > 0 && <th className={`${th} text-right`}>{dt(`На точку, ${finYears.at(-1)}`, `Per unit, ${finYears.at(-1)}`)}</th>}
              <th className={`${th} pr-3`}>{dt("Примечание", "Note")}</th>
            </tr>
          </thead>
          <tbody>
            {pizza.map(({ c, units, paused, entry }) => (
              <tr key={c.key} className="border-t border-line align-top">
                <td className="py-2 pl-3 pr-3">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    <span className="inline-block size-2 rounded-full" style={{ background: colors.get(c.key) }} />
                    {c.name}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right text-ink" style={mono}>
                  {units}
                  {paused ? <div className="text-ink-mute" style={{ fontSize: 11 }}>{dt(`пауза: ${paused}`, `paused: ${paused}`)}</div> : null}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-ink-soft" style={mono}>{entry && yearOf(entry) ? entry.slice(0, 7) : "—"}</td>
                {finYears.map((fy) => <td key={fy} className="py-2 pr-3 text-right text-ink" style={mono}>{money(revByYear.get(fy)?.get(c.key) ?? null)}</td>)}
                {finYears.length > 0 && <td className="py-2 pr-3 text-right font-semibold text-ink" style={mono}>{money(perUnit(c.key, finYears.at(-1)!))}</td>}
                <td className="max-w-[280px] py-2 pr-3 text-ink-mute" style={{ fontSize: 11.5 }}>{userNote(c.notes) ?? c.operator ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      {bars.length > 0 && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="mb-2 font-semibold text-ink" style={{ fontSize: 13 }}>{dt("Выручка на одну пиццерию в год, €", "Revenue per pizzeria per year, €")}</div>
          <div className="flex flex-col gap-2">
            {pizza.filter((p) => bars.some((b) => b.key === p.c.key)).map((p) => (
              <div key={p.c.key} className="grid grid-cols-[110px_1fr] items-center gap-2" style={{ fontSize: 12.5 }}>
                <span className="text-ink-soft">{p.c.name}</span>
                <span className="flex flex-col gap-1">
                  {bars.filter((b) => b.key === p.c.key).map((b, i, arr) => (
                    <span key={b.fy} className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 rounded-sm" style={{ width: `${(b.v / barMax) * 75}%`, background: colors.get(p.c.key), opacity: i === arr.length - 1 ? 1 : 0.5 }} />
                      <span className="text-ink-mute" style={{ ...mono, fontSize: 10.5 }}>{money(b.v)} · {b.fy}</span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {matrix.rows.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 font-semibold text-ink" style={{ fontSize: 14 }}>{dt("Цены, средняя пицца ~30 см", "Prices, medium pizza ~30 cm")}</h3>
          <p className="mb-2 text-ink-mute" style={{ fontSize: 12 }}>
            {dt("Размер, ближайший к 30 см; ниже — цена за 100 см². Подсвечена самая низкая цена за 100 см² в строке.", "Size closest to 30 cm; below — price per 100 cm². The lowest price per 100 cm² in a row is highlighted.")}
            {pricesOn && dt(` Цены сняты ${pricesOn}.`, ` Prices taken ${pricesOn}.`)}
          </p>
          <ScrollX>
            <table className="w-full min-w-[720px] border-collapse" style={{ fontSize: 12.5 }}>
              <thead>
                <tr style={{ fontSize: 10.5 }}>
                  <th className={`${th} pl-3 text-left`}>{dt("Пицца", "Pizza")}</th>
                  {matrix.cols.map((c) => (
                    <th key={`${c.chain}|${c.channel}`} className={`${th} text-right`}>{name.get(c.chain) ?? c.chain}, {dt(...CHANNEL[c.channel])}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r, ri) => (
                  <tr key={r.type} className="border-t border-line align-top">
                    <td className="py-2 pl-3 pr-3 font-semibold text-ink">{dt(...PIZZA[r.type])}</td>
                    {r.cells.map((cell, ci) => (
                      <td
                        key={ci}
                        className="py-2 pr-3 text-right"
                        style={{ background: cell?.per100 != null && cell.per100 === minPer100[ri] ? "var(--accent)" : undefined }}
                      >
                        {cell
                          ? (
                            <>
                              <div className="font-semibold text-ink" style={mono}>€{dec(cell.price)}</div>
                              <div className="text-ink-mute" style={{ ...mono, fontSize: 11 }}>
                                {cell.cm ? `${ru ? String(cell.cm).replace(".", ",") : cell.cm}\u00a0${dt("см", "cm")}` : dt("размер не указан", "size n/a")}
                                {cell.per100 !== null ? ` · €${dec(cell.per100)}\u00a0/\u00a0100\u00a0${dt("см²", "cm²")}` : ""}
                              </div>
                              <div className="text-ink-mute" style={{ fontSize: 11 }}>{cell.item}</div>
                            </>
                          )
                          : <span className="text-ink-mute">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </>
      )}
      <SourceCaption bundle={bundle} feeds={["financials", "prices"]} />
    </Section>
  );
}
