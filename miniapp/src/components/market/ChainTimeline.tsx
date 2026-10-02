"use client";
// Таймлайн эталона (#timeline): дорожки сетей с отметкой на каждое открытие, анонс и
// закрытие, столбцы «Открытий за год», легенда и карточки событий по годам. Отметки — из
// реестра точек; события — из ручной части (editorial.events), без неё — вычисленные из
// реестра и фактов (сделки, прочие события).
import { type PointerEvent, type ReactNode, useMemo, useState } from "react";
import type { MarketBundle, MarketLocation } from "@/types";
import type { EdEventKind } from "@/lib/marketEditorial";
import {
  editorialEvent,
  events,
  eventsByYear,
  marksPerYear,
  refEvent,
  type RefEvent,
  TIMELINE_FROM,
  timelineMarks,
  type TlMark,
} from "@/lib/marketInsights";
import { useDt, useLang } from "@/components/roy/nav";
import { fmtDate, RefSection, Sw, useChainColor, useEditorial, useTip } from "./ref";
import { Empty, SourceCaption } from "./ui";

type Dt = (ru: string, en: string) => string;

// Геометрия эталона: ширина 1180, подписи дорожек 130, справа «+N» 40.
const W = 1180, LW = 130, RW = 40, ROW_H = 30, TOP0 = 26, MIN_W = 900;
const BARS_H = 210, BARS_T = 22, BARS_B = 26, BAR_W = 46, TICK = 5;
// Вычисленных событий за год бывают сотни — карточка показывает первые, остальные по кнопке.
const PER_CARD = 8;

const TAG: Record<EdEventKind, [string, string, string]> = {
  entry: ["Вход", "Entry", "entry"],
  exit: ["Уход", "Exit", "exit"],
  deal: ["Сделка", "Deal", "deal"],
  open: ["Открытие", "Opening", ""],
  plan: ["Анонс", "Announced", "deal"],
  pause: ["Пауза", "Pause", "exit"],
};

const STATUS: Record<MarketLocation["status"], [string, string]> = {
  open: ["Работает", "Operating"],
  closed: ["Закрыта", "Closed"],
  planned: ["Анонс", "Announced"],
  paused: ["Приостановлена", "Paused"],
};

/** Подсказка точки — locTip эталона. */
function LocTip({ l, chain, dt, ru }: { l: MarketLocation; chain: string; dt: Dt; ru: boolean }) {
  return (
    <>
      <b>{l.name}</b>
      <br />
      <span className="k">{chain}{l.city ? ` · ${l.city}` : ""}</span>
      {l.address && <><br />{l.address}</>}
      <br />
      <span className="k">{dt("Открытие:", "Opened:")}</span> {fmtDate(l.opened, ru)}
      {l.opened_estimated ? dt(" (оценка)", " (estimate)") : ""}
      {l.status !== "open" && (
        <>
          <br />
          <span className="k">{dt("Статус:", "Status:")}</span> {dt(...STATUS[l.status])}
          {l.closed ? `${l.status === "paused" ? dt(" с ", " since ") : " "}${fmtDate(l.closed, ru)}` : ""}
        </>
      )}
      {l.format && <><br /><span className="k">{l.format}</span></>}
    </>
  );
}

// «Dodo Pizza — Dodo Pizza Bucharest-5»: название сети уже стоит жирным, из названия точки
// его убираем. Если от названия ничего не остаётся — оставляем как было.
function withoutBrand(text: string, brand: string | null): string {
  if (!brand || !text.toLowerCase().startsWith(brand.toLowerCase())) return text;
  const rest = text.slice(brand.length).replace(/^[\s,—–-]+/, "");
  return rest || text;
}

export function ChainTimeline({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const ed = useEditorial(bundle);
  const col = useChainColor(bundle);
  const now = useMemo(() => new Date(), []);
  const thisYear = now.getFullYear();
  const years = useMemo(() => Array.from({ length: thisYear - TIMELINE_FROM + 1 }, (_, i) => TIMELINE_FROM + i), [thisYear]);
  const bakery = useMemo(() => new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key)), [bundle.chains]);
  const name = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const marks = useMemo(() => timelineMarks(bundle.locations, bakery, TIMELINE_FROM), [bundle.locations, bakery]);
  const curated = ed.events.length > 0;
  const evs = useMemo(
    () => (curated ? ed.events.map(editorialEvent) : events(bundle, TIMELINE_FROM - 1).map(refEvent).map((e) => ({ ...e, chain: e.chain ? name.get(e.chain) ?? e.chain : null }))),
    [curated, ed.events, bundle, name],
  );
  // Дорожки — сети с отметками, по слоту, потом по имени (как у эталона).
  const lanes = useMemo(() => {
    const slot = new Map(bundle.chains.map((c) => [c.key, c.slot || 99]));
    return [...new Set(marks.map((m) => m.loc.chain_key))]
      .sort((a, b) => (slot.get(a) ?? 99) - (slot.get(b) ?? 99) || (name.get(a) ?? a).localeCompare(name.get(b) ?? b));
  }, [marks, bundle.chains, name]);

  const title = dt(`Открытия и закрытия, ${TIMELINE_FROM} – ${thisYear}`, `Openings and closures, ${TIMELINE_FROM} – ${thisYear}`);
  const lede = ed.texts.timeline ?? dt(
    "Каждая отметка — ресторан. Закрашенный кружок — точная дата (месяц или день), полый — известен только год, крест — закрытие, пунктир — анонс.",
    "Each mark is a restaurant. Filled dot — exact date (month or day), hollow — year only, cross — closure, dashed — announced.",
  );

  return (
    <RefSection id="timeline" eyebrow={dt("Таймлайн", "Timeline")} title={title} lede={lede}>
      {!lanes.length && !evs.length && <Empty text={dt("Нет точек с датой открытия.", "No locations with an opening date.")} />}
      {lanes.length > 0 && (
        <>
          <div className="panel scroll"><Lanes lanes={lanes} marks={marks} name={name} col={col} now={now} dt={dt} ru={ru} /></div>
          <div className="panel scroll" style={{ padding: "12px 4px 4px" }}>
            <PerYear marks={marks} years={years} slotOf={bundle.chains} name={name} col={col} now={now} dt={dt} />
          </div>
          <div className="legend">
            {lanes.map((k) => <span key={k}><Sw color={col(k)} />{name.get(k) ?? k}</span>)}
          </div>
        </>
      )}
      {evs.length > 0 && (
        <div className="events">
          {eventsByYear(evs).map(([y, list]) => <YearCard key={y} year={y} items={list} collapse={!curated} dt={dt} ru={ru} />)}
        </div>
      )}
      <SourceCaption bundle={bundle} feeds={curated ? ["locations", "editorial"] : ["locations", "facts"]} />
    </RefSection>
  );
}

type Col = (key: string) => string;

function Lanes(
  { lanes, marks, name, col, now, dt, ru }: { lanes: string[]; marks: Array<TlMark<MarketLocation>>; name: Map<string, string>; col: Col; now: Date; dt: Dt; ru: boolean },
) {
  const tip = useTip();
  const thisYear = now.getFullYear();
  const t0 = new Date(TIMELINE_FROM, 0, 1).getTime(), t1 = new Date(thisYear + 1, 0, 1).getTime();
  const h = TOP0 + lanes.length * ROW_H + 10;
  const X = (t: number) => LW + ((t - t0) / (t1 - t0)) * (W - LW - RW);
  const xt = X(now.getTime());
  const grid = Array.from({ length: thisYear + 2 - TIMELINE_FROM }, (_, i) => TIMELINE_FROM + i);
  const show = (m: TlMark<MarketLocation>, e: PointerEvent) => {
    const head = m.kind === "close" ? dt("Закрытие", "Closure") : m.kind === "plan" ? dt("Анонс", "Announced") : null;
    const chain = name.get(m.loc.chain_key) ?? m.loc.chain_key;
    tip.show(<>{head && <><b>{head}</b><br /></>}<LocTip l={m.loc} chain={chain} dt={dt} ru={ru} /></>, e);
  };
  return (
    <svg className="tlsvg" viewBox={`0 0 ${W} ${h}`} width={W} style={{ minWidth: MIN_W, width: "100%" }} role="img" aria-label={dt("Открытия по сетям", "Openings by chain")}>
      {grid.map((y) => {
        const x = X(new Date(y, 0, 1).getTime());
        return (
          <g key={y}>
            <line x1={x} x2={x} y1={TOP0 - 6} y2={h - 6} stroke="var(--line2)" strokeWidth={1} />
            {y <= thisYear && <text x={x + 6} y={16} className="ax">{y}</text>}
          </g>
        );
      })}
      <line x1={xt} x2={xt} y1={TOP0 - 6} y2={h - 6} stroke="var(--accent)" strokeDasharray="3 3" />
      <text x={xt + 4} y={h - 10} className="ax" style={{ fill: "var(--accent)" }}>{dt("сегодня", "today")}</text>
      {lanes.map((k, i) => {
        const y = TOP0 + i * ROW_H + ROW_H / 2;
        const own = marks.filter((m) => m.loc.chain_key === k);
        return (
          <g key={k}>
            <line x1={LW} x2={W - RW} y1={y} y2={y} stroke="var(--line2)" />
            <text x={0} y={y + 4}>{name.get(k) ?? k}</text>
            <text x={W - 4} y={y + 4} textAnchor="end" className="ax">+{own.filter((m) => m.kind === "open").length}</text>
            {own.map((m, j) => <Mark key={`${m.loc.id}-${m.kind}-${j}`} m={m} x={X(m.t)} y={y} color={col(k)} onMove={(e) => show(m, e)} onLeave={tip.hide} />)}
          </g>
        );
      })}
    </svg>
  );
}

function Mark(
  { m, x, y, color, onMove, onLeave }: { m: TlMark<MarketLocation>; x: number; y: number; color: string; onMove: (e: PointerEvent) => void; onLeave: () => void },
) {
  const ev = { onPointerMove: onMove, onPointerLeave: onLeave, style: { cursor: "default" } };
  if (m.kind === "close") {
    const d = 5;
    return (
      <g {...ev}>
        <path d={`M${x - d},${y - d}L${x + d},${y + d}M${x - d},${y + d}L${x + d},${y - d}`} stroke="var(--bad)" strokeWidth={2.2} strokeLinecap="round" />
        <circle cx={x} cy={y} r={9} fill="transparent" />
      </g>
    );
  }
  if (m.kind === "plan") return <circle cx={x} cy={y} r={6} fill="var(--surface)" stroke={color} strokeWidth={2} strokeDasharray="2.5 2" {...ev} />;
  if (m.precise) return <circle cx={x} cy={y} r={6} fill={color} stroke="var(--surface)" strokeWidth={2} {...ev} />;
  return <circle cx={x} cy={y} r={5} fill="var(--surface)" stroke={color} strokeWidth={2} {...ev} />;
}

function PerYear(
  { marks, years, slotOf, name, col, now, dt }: {
    marks: Array<TlMark<MarketLocation>>;
    years: number[];
    slotOf: MarketBundle["chains"];
    name: Map<string, string>;
    col: Col;
    now: Date;
    dt: Dt;
  },
) {
  const tip = useTip();
  const thisYear = now.getFullYear();
  const slot = new Map(slotOf.map((c) => [c.key, c.slot || 99]));
  const rows = marksPerYear(marks, years);
  const mx = Math.max(1, ...rows.map((r) => r.total));
  const t0 = new Date(TIMELINE_FROM, 0, 1).getTime(), t1 = new Date(thisYear + 1, 0, 1).getTime();
  const X = (t: number) => LW + ((t - t0) / (t1 - t0)) * (W - LW - RW);
  const Y = (v: number) => BARS_H - BARS_B - (v / mx) * (BARS_H - BARS_T - BARS_B);
  const ticks = Array.from({ length: Math.floor(mx / TICK) + 1 }, (_, i) => i * TICK);
  const months = now.getMonth();
  return (
    <svg className="tlsvg" viewBox={`0 0 ${W} ${BARS_H}`} style={{ minWidth: MIN_W, width: "100%" }} role="img" aria-label={dt("Открытий за год", "Openings per year")}>
      <text x={LW} y={12} className="ax">{dt("Открытий за год (с известной датой)", "Openings per year (with a known date)")}</text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={LW} x2={W - RW} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
          <text x={LW - 8} y={Y(v) + 4} textAnchor="end" className="ax">{v}</text>
        </g>
      ))}
      {rows.map((r) => {
        const xc = X(new Date(r.year, 6, 1).getTime()), a = xc - BAR_W / 2, b = xc + BAR_W / 2;
        const parts = [...r.byChain].sort((p, q) => (slot.get(p[0]) ?? 99) - (slot.get(q[0]) ?? 99));
        let acc = 0;
        const bars: ReactNode[] = parts.map(([k, v], j) => {
          const y0 = Y(acc), y1 = Y(acc + v);
          acc += v;
          // Верхний кусок столбца скруглён, как у эталона.
          const d = j === parts.length - 1
            ? `M${a},${y0}V${y1 + 3}Q${a},${y1} ${a + 3},${y1}H${b - 3}Q${b},${y1} ${b},${y1 + 3}V${y0}Z`
            : `M${a},${y0}V${y1}H${b}V${y0}Z`;
          return (
            <path
              key={k}
              d={d}
              fill={col(k)}
              stroke="var(--surface)"
              strokeWidth={1.5}
              onPointerMove={(e) => tip.show(<><b>{r.year}</b><br />{name.get(k) ?? k}: {v}</>, e)}
              onPointerLeave={tip.hide}
            />
          );
        });
        return (
          <g key={r.year}>
            {bars}
            <text x={xc} y={Y(r.total) - 6} textAnchor="middle" style={{ fontWeight: 600, fill: "var(--ink)" }}>{r.total}</text>
            <text x={xc} y={BARS_H - 8} textAnchor="middle" className="ax">
              {r.year === thisYear ? dt(`${r.year} (${months} мес.)`, `${r.year} (${months} mo.)`) : r.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function YearCard({ year, items, collapse, dt, ru }: { year: string; items: RefEvent[]; collapse: boolean; dt: Dt; ru: boolean }) {
  const [all, setAll] = useState(false);
  // Вычисленных событий много: сначала то, что меняет рынок (входы, уходы, сделки), рядовые
  // открытия — после; внутри показанного — снова по дате.
  const rank = (e: RefEvent) => (e.kind === "open" ? 1 : 0);
  const cut = collapse && !all && items.length > PER_CARD;
  const shown = cut
    ? items.map((e, i) => ({ e, i })).sort((p, q) => rank(p.e) - rank(q.e) || p.i - q.i).slice(0, PER_CARD).sort((p, q) => p.i - q.i).map((x) => x.e)
    : items;
  return (
    <div className="panel yr">
      <h3>{year}</h3>
      {shown.map((e, i) => {
        const tag = e.kind ? TAG[e.kind] : null;
        return (
          <div key={`${e.date}-${i}`} className="ev">
            <span className="d">{e.date.length > 4 ? fmtDate(e.date, ru).replace(` ${year}`, "") : dt("год", "year")}</span>
            <span>
              <span className={`tag ${tag ? tag[2] : ""}`}>{tag ? dt(tag[0], tag[1]) : dt("Событие", "Event")}</span>
              {e.chain && <><b>{e.chain}</b> — </>}
              {collapse ? withoutBrand(e.text, e.chain) : e.text}
            </span>
          </div>
        );
      })}
      {collapse && items.length > PER_CARD && (
        <button type="button" onClick={() => setAll(!all)} style={{ alignSelf: "flex-start", fontSize: 12, color: "var(--accent)" }}>
          {all ? dt("Свернуть", "Collapse") : dt(`Ещё ${items.length - PER_CARD}`, `${items.length - PER_CARD} more`)}
        </button>
      )}
    </div>
  );
}
