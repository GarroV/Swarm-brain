"use client";
// Операции Dodo (кусок «DODO OPS» эталона): плитки #opsK, заказы по месяцам и каналам #opsOrd,
// средний чек по каналам #opsAc и таблица по пиццериям #opsT — всё из ручной части
// (editorial.dodo_ops). Без неё — только заказы по каналам из публичного API Dodo.
import type { ReactNode } from "react";
import type { MarketBundle } from "@/types";
import type { EdDodoOps } from "@/lib/marketEditorial";
import { countryName } from "@/lib/countries";
import { fullOrderMonths } from "@/lib/marketInsights";
import { type OpsSum, opsByMonth, opsByUnit, opsSum, scaleBottom, scaleTop, ticks } from "@/lib/marketDodo";
import { orderChannels } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { dec, intFmt, monthShort, useTip } from "./ref";

type Chan = { rk: "agg" | "din" | "own"; ok: "oagg" | "odin" | "oown"; name: [string, string]; color: string };
const CHN: Chan[] = [
  { rk: "agg", ok: "oagg", name: ["Агрегаторы", "Aggregators"], color: "var(--accent)" },
  { rk: "din", ok: "odin", name: ["Зал", "Dine-in"], color: "var(--orange)" },
  { rk: "own", ok: "oown", name: ["Своя доставка", "Own delivery"], color: "var(--teal)" },
];
const W = 520, H = 230;

/** Подзаголовок куска операций, как в эталоне. */
function OpsHead({ title, note }: { title: string; note: string | null }) {
  return (
    <div className="sec-head" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 18 }}>{title}</h3>
      {note && <p className="small">{note}</p>}
    </div>
  );
}

type Bar = { label: string; tipHead: string; parts: Array<{ v: number; color: string; name: string; extra: string | null }>; total: number };

/** Столбцы заказов со стеком каналов и итогом сверху (#opsOrd). */
function OrdersChart({ bars }: { bars: Bar[] }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const tip = useTip();
  const BT = 16, BB = 24, STEP = 2500;
  const mx = scaleTop(Math.max(0, ...bars.map((b) => b.total)), STEP, 7500);
  // Отступ под подписи шкалы: у эталона 40 под «7 500»; длиннее подпись — шире отступ.
  const L = Math.max(40, 10 + CHAR_W * intFmt(mx, ru).length);
  const Y = (v: number) => H - BB - (v / mx) * (H - BT - BB);
  const bw = (W - L) / Math.max(1, bars.length);
  const pc = (v: number) => `${dec(v * 100, 1, ru)}%`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
      {ticks(0, mx, STEP).map((v) => (
        <g key={v}>
          <line x1={L} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
          <text x={L - 6} y={Y(v) + 4} textAnchor="end">{intFmt(v, ru)}</text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = L + i * bw + 6, w = Math.max(1, bw - 12);
        let acc = 0;
        const last = b.parts.map((p) => p.v > 0).lastIndexOf(true);
        return (
          <g key={i}>
            {b.parts.map((p, j) => {
              if (!p.v) return null;
              const y0 = Y(acc), y1 = Y(acc + p.v);
              acc += p.v;
              return (
                <rect
                  key={j}
                  x={x}
                  y={y1}
                  width={w}
                  height={Math.max(0, y0 - y1 - (j < last ? 1.5 : 0))}
                  fill={p.color}
                  rx={j === last ? 2 : 0}
                  onPointerMove={(e) =>
                    tip.show(
                      <>
                        <b>{b.tipHead} · {p.name}</b>
                        <br />
                        {intFmt(p.v, ru)} {dt("заказов", "orders")} ({pc(p.v / b.total)})
                        {p.extra && <><br /><span className="k">{dt("средний чек", "average check")}</span> {p.extra}</>}
                      </>,
                      e,
                    )}
                  onPointerLeave={tip.hide}
                />
              );
            })}
            <text x={x + w / 2} y={H - 8} textAnchor="middle">{b.label}</text>
            <text x={x + w / 2} y={Y(b.total) - 5} textAnchor="middle" style={{ fill: "var(--ink2)" }}>{totalLabel(b.total, bw, ru)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Подпись над столбцом: полное число, а если оно шире столбца (много месяцев) — в тысячах, чтобы соседние не слипались. */
const CHAR_W = 6.5;
function totalLabel(v: number, bw: number, ru: boolean): string {
  const full = intFmt(v, ru);
  return full.length * CHAR_W + 6 <= bw ? full : `${dec(v / 1000, 1, ru)}k`;
}

type Series = { name: string; color: string; dashed: boolean; vals: Array<number | null> };

/** Средний чек по каналам линиями и пунктир «Все каналы» (#opsAc). */
function AvgCheckChart({ series, labels, tipHead }: { series: Series[]; labels: string[]; tipHead: (i: number) => string }) {
  const ru = useLang() === "ru";
  const tip = useTip();
  const L = 34, R = 70, BT = 14, BB = 24, STEP = 4;
  const all = series.flatMap((s) => s.vals).filter((v): v is number => v !== null);
  const mn = scaleBottom(Math.min(...all), STEP, 10), mx = scaleTop(Math.max(...all), STEP, 26);
  const n = labels.length;
  const Y = (v: number) => H - BB - ((v - mn) / (mx - mn)) * (H - BT - BB);
  const X = (i: number) => (n > 1 ? L + (i / (n - 1)) * (W - L - R) : L + (W - L - R) / 2);
  const eur2 = (v: number) => `€${dec(v, 2, ru)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
      {ticks(mn, mx, STEP).map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
          <text x={L - 6} y={Y(v) + 4} textAnchor="end">€{v}</text>
        </g>
      ))}
      {series.map((s) => {
        const pts = s.vals.map((v, i) => (v === null ? null : ([X(i), Y(v)] as const)));
        const lastV = s.vals[n - 1];
        return (
          <g key={s.name}>
            <polyline points={pts.filter((p) => p !== null).map((p) => p!.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "4 3" : "none"} />
            {s.vals.map((v, i) =>
              v === null ? null : (
                <g key={i}>
                  <circle cx={X(i)} cy={Y(v)} r={i === n - 1 ? 4 : 2.5} fill={s.color} stroke="var(--surface)" strokeWidth={1} />
                  <circle cx={X(i)} cy={Y(v)} r={9} fill="transparent" onPointerMove={(e) => tip.show(<><b>{tipHead(i)}</b><br />{s.name}: {eur2(v)}</>, e)} onPointerLeave={tip.hide} />
                </g>
              )
            )}
            {lastV != null && <text x={X(n - 1) + 8} y={Y(lastV) + 4} style={{ fill: "var(--ink2)" }}>{eur2(lastV)}</text>}
          </g>
        );
      })}
      {labels.map((l, i) => <text key={i} x={X(i)} y={H - 6} textAnchor="middle">{l}</text>)}
    </svg>
  );
}

function Legend({ items }: { items: Array<{ name: string; color: string }> }) {
  return (
    <div className="legend">
      {items.map((it) => <span key={it.name}><i className="sw" style={{ background: it.color, borderRadius: 2 }} />{it.name}</span>)}
    </div>
  );
}

const div = (a: number, b: number) => (b ? a / b : null);

/** Кусок операций по ручной части. */
export function DodoOpsEditorial({ rows, texts, country }: { rows: EdDodoOps[]; texts: Record<string, string>; country: string }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const T = opsSum(rows), byM = opsByMonth(rows), byU = opsByUnit(rows);
  const months = byM.map((d) => d.m);
  const MN = (m: number) => monthShort(m, ru);
  const span = months.length > 1 ? `${MN(months[0])}–${MN(months.at(-1)!)}` : MN(months[0]);
  const period = texts.ops_period ?? span;
  const year = (texts.ops_period ?? texts.ops_title ?? "").match(/\b(?:19|20)\d\d\b/)?.[0] ?? null;
  const head = (m: number) => (year ? `${MN(m)} ${year}` : MN(m));
  const eur = (v: number) => `€${intFmt(v, ru)}`;
  const eur2 = (v: number | null) => (v === null ? "—" : `€${dec(v, 2, ru)}`);
  const pc = (v: number | null) => (v === null ? "—" : `${dec(v * 100, 1, ru)}%`);
  const units = byU.length - 1;
  const lower = period.charAt(0).toLowerCase() + period.slice(1);
  const ago = texts.ops_avg_year_ago && texts.ops_avg_year_ago_period
    ? dt(`; год назад, в ${texts.ops_avg_year_ago_period}, — ${texts.ops_avg_year_ago}`, `; a year earlier, in ${texts.ops_avg_year_ago_period}, ${texts.ops_avg_year_ago}`)
    : "";
  const who = units === 2 ? dt("обе пиццерии", "both pizzerias") : dt(`пиццерий: ${units}`, `pizzerias: ${units}`);
  const kpis: Array<[string, string, string]> = [
    [intFmt(T.o, ru), dt(`заказов за ${lower}`, `orders, ${period}`), dt(`${who}, в среднем ${intFmt(T.o / months.length, ru)} в месяц`, `${who}, ${intFmt(T.o / months.length, ru)} a month on average`)],
    [eur2(div(T.rev, T.o)), dt("средний чек", "average check"), dt(`выручка ${eur(T.rev)} с НДС`, `revenue ${eur(T.rev)} incl. VAT`) + ago],
    [pc(div(T.agg, T.rev)), dt("выручки через агрегаторы", "of revenue via aggregators"), dt(`${pc(div(T.oagg, T.o))} заказов, средний чек ${eur2(div(T.agg, T.oagg))}`, `${pc(div(T.oagg, T.o))} of orders, average check ${eur2(div(T.agg, T.oagg))}`)],
    [pc(div(T.own, T.rev)), dt("выручки — своя доставка", "of revenue via own delivery"), dt(`${pc(div(T.oown, T.o))} заказов, средний чек ${eur2(div(T.own, T.oown))}`, `${pc(div(T.oown, T.o))} of orders, average check ${eur2(div(T.own, T.oown))}`)],
  ];
  // В эталоне у агрегаторов в подсказках и легенде среднего чека — список площадок страны.
  const chName = (c: Chan) => (c.rk === "agg" && texts.ops_aggregators) || dt(...c.name);
  const bars: Bar[] = byM.map((d) => ({
    label: MN(d.m),
    tipHead: head(d.m),
    total: d.o,
    parts: CHN.map((c) => ({ v: d[c.ok], color: c.color, name: chName(c), extra: eur2(div(d[c.rk], d[c.ok])) })),
  }));
  const series: Series[] = [
    ...CHN.map((c) => ({ name: chName(c), color: c.color, dashed: false, vals: byM.map((d) => div(d[c.rk], d[c.ok])) })),
    { name: dt("Все каналы", "All channels"), color: "var(--ink2)", dashed: true, vals: byM.map((d) => div(d.rev, d.o)) },
  ];
  const R2: Array<[string, (u: OpsSum) => ReactNode]> = [
    [dt("Выручка, с НДС", "Revenue, incl. VAT"), (u) => eur(u.rev)],
    [dt("Заказы", "Orders"), (u) => intFmt(u.o, ru)],
    [dt("Средний чек", "Average check"), (u) => <b>{eur2(div(u.rev, u.o))}</b>],
    [dt("Средний чек: агрегаторы", "Average check: aggregators"), (u) => eur2(div(u.agg, u.oagg))],
    [dt("Средний чек: зал", "Average check: dine-in"), (u) => eur2(div(u.din, u.odin))],
    [dt("Средний чек: своя доставка", "Average check: own delivery"), (u) => eur2(div(u.own, u.oown))],
    [dt("Доля выручки: агрегаторы / зал / своя", "Revenue share: aggregators / dine-in / own"), (u) => `${pc(div(u.agg, u.rev))} / ${pc(div(u.din, u.rev))} / ${pc(div(u.own, u.rev))}`],
    [dt("Доля заказов: агрегаторы / зал / своя", "Order share: aggregators / dine-in / own"), (u) => `${pc(div(u.oagg, u.o))} / ${pc(div(u.odin, u.o))} / ${pc(div(u.oown, u.o))}`],
  ];
  return (
    <>
      <OpsHead title={texts.ops_title ?? dt(`Dodo, ${lower}: заказы, средний чек и каналы`, `Dodo, ${period}: orders, average check and channels`)} note={texts.ops_note ?? null} />
      <div className="kpis">
        {kpis.map(([b, s, m]) => <div key={s} className="kpi"><b>{b}</b><span>{s}</span><small>{m}</small></div>)}
      </div>
      <div className="pgrid">
        <div className="panel chartbox">
          <h3>{units === 2 ? dt("Заказы по месяцам и каналам, обе пиццерии", "Orders by month and channel, both pizzerias") : dt("Заказы по месяцам и каналам", "Orders by month and channel")}</h3>
          <OrdersChart bars={bars} />
          <Legend items={CHN.map((c) => ({ name: dt(...c.name), color: c.color }))} />
        </div>
        <div className="panel chartbox">
          <h3>{dt("Средний чек по каналам, €", "Average check by channel, €")}</h3>
          <AvgCheckChart series={series} labels={months.map(MN)} tipHead={(i) => head(months[i])} />
          <Legend items={series} />
        </div>
      </div>
      <div className="panel scroll">
        <table>
          <thead>
            <tr>
              <th>{period}</th>
              {byU.map((u) => <th key={u.u ?? ""} className="r">{u.u ? texts[`ops_unit_${u.u}`] ?? u.u : (ru ? countryName(country) : dt("Итого", "Total"))}</th>)}
            </tr>
          </thead>
          <tbody>
            {R2.map(([n, f]) => <tr key={n}><td>{n}</td>{byU.map((u) => <td key={u.u ?? ""} className="r">{f(u)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}

const CHANNEL: Record<string, [string, string, string]> = {
  aggregator: ["Агрегаторы", "Aggregators", "var(--accent)"],
  restaurant: ["Зал", "Dine-in", "var(--orange)"],
  pizzeria: ["Зал", "Dine-in", "var(--orange)"],
  site: ["Сайт", "Website", "var(--teal)"],
  mobile: ["Приложение", "App", "var(--s1)"],
  phone: ["Телефон", "Phone", "var(--s5)"],
  kiosk: ["Киоск", "Kiosk", "var(--s4)"],
};
const OTHER_COLOR = "var(--s0)";
const ORDER_MONTHS = 12;

/** Запасной вариант без ручной части: заказы по каналам из публичного API Dodo, полные месяцы. */
export function DodoOpsComputed({ bundle, now }: { bundle: MarketBundle; now: Date }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const months = fullOrderMonths(bundle.dodo, now).slice(-ORDER_MONTHS).filter((m) => Object.keys(orderChannels(m.orders)).length);
  if (!months.length) return null;
  const channels = [...new Set(months.flatMap((m) => Object.keys(orderChannels(m.orders))))];
  const meta = (c: string) => CHANNEL[c] ?? [c, c, OTHER_COLOR];
  const bars: Bar[] = months.map((m) => {
    const ch = orderChannels(m.orders);
    const mm = Number(m.month.slice(5, 7));
    return {
      label: monthShort(mm, ru),
      tipHead: `${monthShort(mm, ru)} ${m.month.slice(0, 4)}`,
      total: Object.values(ch).reduce((s, v) => s + v, 0),
      parts: channels.map((c) => ({ v: ch[c] ?? 0, color: meta(c)[2], name: dt(meta(c)[0], meta(c)[1]), extra: null })),
    };
  });
  return (
    <>
      <OpsHead title={dt("Dodo: заказы по каналам", "Dodo: orders by channel")} note={dt("Публичный API Dodo, только полные месяцы работы.", "Dodo public API, full months of operation only.")} />
      {/* В эталоне график занимает половину ряда .pgrid: во всю ширину viewBox 520 раздувает подписи. */}
      <div className="panel chartbox" style={{ maxWidth: 640 }}>
        <h3>{dt("Заказы по месяцам и каналам", "Orders by month and channel")}</h3>
        <OrdersChart bars={bars} />
        <Legend items={[...new Map(channels.map((c) => [dt(meta(c)[0], meta(c)[1]), meta(c)[2]])).entries()].map(([name, color]) => ({ name, color }))} />
      </div>
    </>
  );
}
