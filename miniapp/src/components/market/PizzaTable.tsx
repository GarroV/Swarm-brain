"use client";
// Таблица пицца-сетей (#pzT эталона) и график «Выручка на одну пиццерию в год» (#pzUnit).
// Строки — из ручной части (editorial.pizza_table), без неё — из реестра и отчётности юрлиц.
import type { MarketBundle } from "@/types";
import { chainRevenue, userNote } from "@/lib/marketInsights";
import { fmtK, scaleTop, ticks } from "@/lib/marketDodo";
import { pizzaPeriods } from "@/lib/marketPizza";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { revenuePerUnit } from "@/lib/marketView";
import type { Editorial } from "@/lib/marketEditorial";
import { useDt, useLang } from "@/components/roy/nav";
import { fmtDate, Sw, useTip } from "./ref";

export type PzRow = { key: string; name: string; units: string; entry: string; rev: Array<number | null>; per: Array<number | null>; lfl: string | null; note: string };
/** Нормализованная таблица: заголовки колонок выручки и «на точку», подписи периодов графика
 *  и прозрачность полос (последний полный год — 1, другой период — .5, как в эталоне). */
export type PzModel = { revHead: string[]; perHead: string[]; perLabel: string[]; opacity: number[]; rows: PzRow[]; lfl: boolean };

type Dt = (ru: string, en: string) => string;
const FIN_YEARS = 2;

export function editorialPizza(ed: Editorial, dt: Dt): PzModel | null {
  if (!ed.pizzaTable.length) return null;
  const { rev, per } = pizzaPeriods(ed.pizzaTable);
  return {
    revHead: rev.map((k) => (/^\d{4}$/.test(k) ? dt(`Выручка ${k}`, `Revenue ${k}`) : k)),
    perHead: per.map((k) => dt(`На точку, ${k}`, `Per unit, ${k}`)),
    perLabel: per.map((k) => ed.texts[`pizza_label_${k}`] ?? k), // подпись периода в графике эталона длиннее, чем в шапке таблицы
    opacity: per.map((_, i) => (i === 0 ? 1 : 0.5)),
    rows: ed.pizzaTable.map((r) => ({
      key: r.chain,
      name: r.name,
      units: r.units,
      entry: r.entry,
      rev: rev.map((k) => r.rev[k] ?? null),
      per: per.map((k) => r.per[k] ?? null),
      lfl: r.lfl,
      note: r.note,
    })),
    lfl: true,
  };
}

/** Запасной вариант: пицца-сети из реестра, выручка — два последних года отчётности. */
export function computedPizza(bundle: MarketBundle, dt: Dt, ru: boolean, y: number): PzModel | null {
  const pizza = bundle.chains
    .filter((c) => c.segment === "pizza")
    .map((c) => {
      const locs = bundle.locations.filter((l) => l.chain_key === c.key);
      const first = locs.map((l) => l.opened).filter((o): o is string => !!o).sort()[0] ?? null;
      return { c, locs, units: aliveAtYearEnd(locs, y, y), paused: locs.filter((l) => l.status === "paused").length, entry: c.first_entry ?? first };
    })
    .filter((x) => x.units > 0 || x.locs.some((l) => l.status === "planned"))
    .sort((a, b) => b.units - a.units);
  if (!pizza.length) return null;
  const years = [...new Set(bundle.financials.filter((f) => f.revenue_eur !== null).map((f) => f.year))].sort().slice(-FIN_YEARS);
  const rev = new Map(years.map((fy) => [fy, chainRevenue(bundle, fy)]));
  const paused = (n: number, all: number) => (!n ? "" : n === all ? dt(" (пауза)", " (paused)") : dt(` (пауза: ${n})`, ` (paused: ${n})`));
  return {
    revHead: years.map((fy) => dt(`Выручка ${fy}`, `Revenue ${fy}`)),
    perHead: years.map((fy) => dt(`На точку, ${fy}`, `Per unit, ${fy}`)),
    perLabel: years.map(String),
    opacity: years.map((_, i) => (i === years.length - 1 ? 1 : 0.5)),
    rows: pizza.map(({ c, locs, units, paused: p, entry }) => ({
      key: c.key,
      name: c.name,
      units: `${units}${paused(p, units)}`,
      entry: entry ? fmtDate(entry.slice(0, 7), ru) : "—",
      rev: years.map((fy) => rev.get(fy)?.get(c.key) ?? null),
      per: years.map((fy) => {
        const v = rev.get(fy)?.get(c.key);
        return v === undefined ? null : revenuePerUnit({ revenue_eur: v, year: fy }, locs);
      }),
      lfl: null,
      note: userNote(c.notes) ?? c.operator ?? "—",
    })),
    lfl: false,
  };
}

export function PizzaTable({ model, color }: { model: PzModel; color: (k: string) => string }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const bold = model.opacity.indexOf(1);
  // Колонка из одних прочерков (страна без ручной части: нет дат входа, заметок, выручки на
  // точку) не показывается — таблица короче и не выглядит недоделанной.
  const hasEntry = model.rows.some((r) => r.entry !== "—");
  const hasNote = model.rows.some((r) => r.note && r.note !== "—");
  const perCols = model.perHead.map((_, i) => i).filter((i) => model.rows.some((r) => r.per[i] !== null));
  return (
    <div className="panel scroll">
      <table>
        <thead>
          <tr>
            <th>{dt("Сеть", "Chain")}</th>
            <th className="r">{dt("Точек", "Units")}</th>
            {hasEntry && <th>{dt("Вход", "Entry")}</th>}
            {model.revHead.map((h) => <th key={h} className="r">{h}</th>)}
            {perCols.map((i) => <th key={model.perHead[i]} className="r">{model.perHead[i]}</th>)}
            {model.lfl && <th>LFL</th>}
            {hasNote && <th>{dt("Примечание", "Note")}</th>}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr key={r.key + r.name}>
              <td style={{ whiteSpace: "nowrap" }}><Sw color={color(r.key)} inline /><b>{r.name}</b></td>
              <td className="r">{r.units}</td>
              {hasEntry && <td style={{ whiteSpace: "nowrap" }}>{r.entry}</td>}
              {r.rev.map((v, i) => <td key={i} className="r">{fmtK(v, ru)}</td>)}
              {perCols.map((i) => <td key={i} className="r">{i === bold ? <b>{fmtK(r.per[i], ru)}</b> : fmtK(r.per[i], ru)}</td>)}
              {model.lfl && <td style={{ whiteSpace: "nowrap" }}>{r.lfl ?? "—"}</td>}
              {hasNote && <td className="small" style={{ minWidth: 220 }}>{r.note}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const UW = 520, ROW_H = 46, BAR_STEP = 17, UL = 96, UNIT_STEP = 300_000, UNIT_BASE = 900_000;

/** Полосы на сеть по периодам «на точку»; нет значения — «нет данных», как в эталоне. */
export function PizzaUnitChart({ model, color }: { model: PzModel; color: (k: string) => string }) {
  const dt = useDt();
  const tip = useTip();
  const n = model.perLabel.length;
  const rh = Math.max(ROW_H, 12 + n * BAR_STEP);
  const h = model.rows.length * rh + 24;
  const mx = scaleTop(Math.max(0, ...model.rows.flatMap((r) => r.per.map((v) => v ?? 0))), UNIT_STEP, UNIT_BASE);
  const X = (v: number) => UL + (v / mx) * (UW - UL - 70);
  return (
    <svg viewBox={`0 0 ${UW} ${h}`} style={{ width: "100%" }}>
      {ticks(0, mx, UNIT_STEP).map((v) => (
        <g key={v}>
          <line x1={X(v)} x2={X(v)} y1={4} y2={h - 18} stroke="var(--line2)" />
          <text x={X(v)} y={h - 4} textAnchor="middle">{v / 1000}</text>
        </g>
      ))}
      {model.rows.map((r, i) => {
        const y = 8 + i * rh;
        return (
          <g key={r.key + r.name}>
            <text x={0} y={y + 18} style={{ fill: "var(--ink)", fontFamily: "var(--f-body)", fontSize: 12.5 }}>{r.name}</text>
            {r.per.map((v, j) => {
              const yy = y + j * BAR_STEP, lab = model.perLabel[j];
              if (v === null) return <text key={j} x={UL + 4} y={yy + 11}>{dt("нет данных", "no data")}</text>;
              return (
                <g key={j}>
                  <rect
                    x={UL}
                    y={yy}
                    width={Math.max(0, X(v) - UL)}
                    height={13}
                    rx={2}
                    fill={color(r.key)}
                    fillOpacity={model.opacity[j]}
                    onPointerMove={(e) => tip.show(<><b>{r.name}</b><br />{lab}: €{Math.round(v / 1000)} {dt("тыс. на точку в год", "k per unit per year")}</>, e)}
                    onPointerLeave={tip.hide}
                  />
                  <text x={X(v) + 6} y={yy + 11} style={{ fill: "var(--ink2)" }}>{Math.round(v / 1000)} · {lab}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
