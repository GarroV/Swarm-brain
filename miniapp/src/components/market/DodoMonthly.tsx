"use client";
// Dodo: продажи по месяцам (#pzDodo эталона) — кусок секции пиццы. Ряд — из ручной части
// (editorial.dodo_monthly: usd × курс = €), без неё — из публичного API Dodo, только полные
// месяцы работы (без месяца открытия, месяцев паузы и текущего).
import type { MarketBundle } from "@/types";
import type { Editorial } from "@/lib/marketEditorial";
import { fullOperatingMonths } from "@/lib/marketInsights";
import { scaleTop, ticks, unitGrowthIndex } from "@/lib/marketDodo";
import { useDt, useLang } from "@/components/roy/nav";
import { fmtDate, intFmt, useTip } from "./ref";

/** Месяц ряда: сумма в евро, исходная сумма и курс (если не в евро), число пиццерий. */
export type DodoBar = { m: string; eur: number; local: number | null; cur: string | null; fx: number | null; units: number | null; incomplete: boolean };
const MONTHS = 36;

export function dodoBars(bundle: MarketBundle, ed: Editorial, now: Date): { bars: DodoBar[]; editorial: boolean } {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (ed.dodoMonthly.length) {
    return {
      editorial: true,
      bars: ed.dodoMonthly.map((d) => ({ m: d.m, eur: d.eur, local: d.usd || null, cur: "$", fx: d.fx || null, units: d.units || null, incomplete: d.m >= current })),
    };
  }
  return {
    editorial: false,
    bars: fullOperatingMonths(bundle.dodo, now).slice(-MONTHS).map((d) => {
      const local = d.currency && d.currency !== "EUR" ? d.revenue_local : null;
      const eur = d.revenue_eur ?? 0;
      return { m: d.month, eur, local, cur: local !== null ? d.currency : null, fx: local ? Math.round((eur / local) * 10000) / 10000 : null, units: d.units, incomplete: false };
    }),
  };
}

/** Имя второй по дате открытия пиццерии Dodo из реестра — подпись пунктира запуска. */
export function secondDodoName(bundle: MarketBundle): string | null {
  const locs = bundle.locations.filter((l) => l.chain_key === "dodo" && l.status !== "planned" && l.opened).sort((a, b) => a.opened!.localeCompare(b.opened!));
  return locs[1]?.name ?? null;
}

const W = 520, H = 220, L = 34, BT = 14, BB = 26, STEP = 40_000, BASE = 120_000;

/** vat — ставка НДС в процентах из ручной части (texts.dodo_vat): с ней подсказка показывает и сумму без НДС, как эталон. */
export function DodoMonthlyChart({ bars, editorial, second, vat = null }: { bars: DodoBar[]; editorial: boolean; second: string | null; vat?: number | null }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const tip = useTip();
  const mx = scaleTop(Math.max(0, ...bars.map((d) => d.eur)), STEP, BASE);
  const bw = (W - L - 6) / bars.length;
  const Y = (v: number) => H - BB - (v / mx) * (H - BT - BB);
  const grow = unitGrowthIndex(bars.map((d) => d.units));
  const num = (v: number) => v.toLocaleString(ru ? "ru" : "en");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
      {ticks(0, mx, STEP).map((v) => (
        <g key={v}>
          <line x1={L} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
          <text x={L - 6} y={Y(v) + 4} textAnchor="end">{v / 1000}</text>
        </g>
      ))}
      {bars.map((d, i) => {
        const x = L + i * bw + 1.5;
        const per = d.units ? Math.round(d.eur / d.units) : null;
        return (
          <g key={d.m}>
            <rect
              x={x}
              y={Y(d.eur)}
              width={Math.max(0, bw - 3)}
              height={Math.max(1, Y(0) - Y(d.eur))}
              rx={2}
              fill={d.incomplete ? "var(--surface)" : "var(--s2)"}
              stroke={d.incomplete ? "var(--muted)" : "none"}
              strokeDasharray="2 2"
              onPointerMove={(e) =>
                tip.show(
                  <>
                    <b>{fmtDate(d.m, ru)}</b>
                    <br />
                    {d.local !== null && d.fx !== null && <>{d.cur === "$" ? `$${num(d.local)}` : `${num(d.local)} ${d.cur}`} × {d.fx} = </>}
                    <b>€{num(d.eur)}</b>
                    {editorial && dt(" с НДС", " incl. VAT")}
                    {editorial && vat !== null && (
                      <>
                        <br />
                        <span className="k">{dt("без НДС:", "excl. VAT:")}</span> €{num(Math.round(d.eur / (1 + vat / 100)))}
                      </>
                    )}
                    {d.units !== null && (
                      <>
                        <br />
                        <span className="k">{dt("пиццерий:", "pizzerias:")}</span> {d.units}
                        {per !== null && <>, {dt("на одну:", "per one:")} €{intFmt(per, ru)}</>}
                      </>
                    )}
                    {d.incomplete && <><br /><b>{dt("Похоже на незакрытый месяц", "Looks like an unclosed month")}</b></>}
                  </>,
                  e,
                )}
              onPointerLeave={tip.hide}
            />
            {(d.m.endsWith("-01") || i === 0) && <text x={x + bw / 2} y={H - 8} textAnchor="start">{d.m.slice(0, 4)}</text>}
            {i === grow && (
              <>
                <line x1={x + bw * 0.7} x2={x + bw * 0.7} y1={BT} y2={Y(0)} stroke="var(--ink2)" strokeDasharray="3 3" />
                <text x={x + bw * 0.7 + 4} y={BT + 8}>{second ?? dt("вторая пиццерия", "second pizzeria")}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
