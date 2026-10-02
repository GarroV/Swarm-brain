"use client";
// Таймлайн по образцу референса: дорожки сетей с отметкой на каждое открытие и закрытие,
// столбцы «Открытий за год» по сетям и карточки событий по годам. Открытия и закрытия
// берутся из реестра точек, сделки и прочие события — из фактов (topic deal / timeline).
import { useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { chainColors } from "@/lib/marketMap";
import { type EventKind, events, openingsByChain, openingsByYear, periods, yearOf } from "@/lib/marketInsights";
import { useDt, useLang } from "@/components/roy/nav";
import { Empty, mono, Section, SourceCaption, useWidth } from "./ui";

const LANES = 9;
// Ширина графика = ширина рамки в пикселях (не больше W_MAX): текст в SVG тогда того же
// кегля, что и вокруг, — на телефоне подписи не сжимаются до 7 px и всё влезает без прокрутки.
const W_MAX = 1000, W_MIN = 320, NARROW = 600, LANE = 30, RIGHT = 44, TOP = 22;
const BAR_H = 190, BAR_PAD = { l: 30, b: 22, t: 18 };
const PER_CARD = 8;
const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND: Record<EventKind, [string, string, string]> = {
  entry: ["вход", "entry", "var(--accent-ink)"],
  open: ["открытие", "opening", "var(--ink-mute)"],
  close: ["уход", "closure", "var(--mkt-s8)"],
  pause: ["пауза", "pause", "var(--mkt-s8)"],
  planned: ["анонс", "announced", "var(--mkt-s4)"],
  deal: ["сделка", "deal", "var(--mkt-s2)"],
  event: ["событие", "event", "var(--ink-mute)"],
};

/** Дата как доля года: «2024-08» → 2024.58; только год — середина года. */
function at(date: string): number | null {
  const y = yearOf(date);
  if (y === null) return null;
  const m = /^\d{4}-(\d{2})/.exec(date);
  const d = /^\d{4}-\d{2}-(\d{2})/.exec(date);
  return m ? y + (Number(m[1]) - 1 + (d ? (Number(d[1]) - 1) / 31 : 0.5)) / 12 : y + 0.5;
}

// «Dodo Pizza — Dodo Pizza Bucharest-5»: название сети уже стоит жирным, из названия точки
// его убираем. Если от названия ничего не остаётся — оставляем как было.
function withoutBrand(text: string, brand: string | undefined): string {
  if (!brand || !text.toLowerCase().startsWith(brand.toLowerCase())) return text;
  const rest = text.slice(brand.length).replace(/^[\s,—–-]+/, "");
  return rest || text;
}

export function ChainTimeline({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const [box, width] = useWidth<HTMLDivElement>();
  const now = useMemo(() => new Date(), []);
  const p = periods(now);
  const thisYear = now.getFullYear();
  const from = p.early[0];
  const years = useMemo(() => Array.from({ length: thisYear - from + 1 }, (_, i) => from + i), [from, thisYear]);
  const bakery = useMemo(() => new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key)), [bundle.chains]);
  const colors = useMemo(() => chainColors(bundle.chains, bundle.locations), [bundle.chains, bundle.locations]);
  const name = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const lanes = useMemo(() => [...openingsByChain(bundle.locations, bakery, [from, thisYear])].slice(0, LANES), [bundle.locations, bakery, from, thisYear]);
  const bars = useMemo(() => openingsByYear(bundle.locations, bakery, years), [bundle.locations, bakery, years]);
  const evs = useMemo(() => events(bundle, from - 1), [bundle, from]);

  if (!lanes.length && !evs.length) {
    return (
      <Section title={dt("Таймлайн", "Timeline")}>
        <Empty text={dt("Нет точек с датой открытия.", "No locations with an opening date.")} />
      </Section>
    );
  }

  const W = Math.min(W_MAX, Math.max(W_MIN, width || W_MAX));
  const LABEL = W < NARROW ? 96 : 130;
  const t0 = from, t1 = thisYear + 1;
  const x = (t: number) => LABEL + ((t - t0) / (t1 - t0)) * (W - LABEL - RIGHT);
  const today = thisYear + now.getMonth() / 12 + now.getDate() / 365;
  const H = TOP + lanes.length * LANE + 8;
  const legend = [...new Set(bars.flatMap((b) => [...b.byChain.keys()]))];
  // Круглый шаг оси (1, 2, 5, 10…) и верх оси кратный ему: «0, 5, 10, 15», а не «0, 10, 19».
  const rawMax = Math.max(1, ...bars.map((b) => b.total));
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => rawMax / s <= 4) ?? 100;
  const maxBar = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: maxBar / step + 1 }, (_, i) => i * step);
  const bw = (W - BAR_PAD.l) / years.length;
  const by = (n: number) => BAR_H - BAR_PAD.b - (n / maxBar) * (BAR_H - BAR_PAD.b - BAR_PAD.t);

  return (
    <Section title={dt(`Открытия и закрытия, ${from}–${thisYear}`, `Openings and closures, ${from}–${thisYear}`)}>
      <p className="-mt-1 mb-3 text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          "Каждая отметка — ресторан. Закрашенный кружок — точная дата (месяц или день), полый — известен только год, крест — закрытие, пунктир — анонс.",
          "Each mark is a restaurant. Filled dot — exact date (month or day), hollow — year only, cross — closure, dashed — announced.",
        )}
      </p>
      {lanes.length > 0 && (
        <>
          <div ref={box} className="overflow-hidden rounded-lg border border-line">
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={dt("Открытия по сетям", "Openings by chain")}>
              {years.map((yr) => (
                <g key={yr}>
                  <line x1={x(yr)} x2={x(yr)} y1={TOP - 6} y2={H} stroke="var(--line)" />
                  <text x={x(yr) + 4} y={TOP - 9} fontSize={10} fill="var(--ink-mute)" style={mono}>{yr}</text>
                </g>
              ))}
              <line x1={x(today)} x2={x(today)} y1={TOP - 6} y2={H} stroke="var(--accent-ink)" strokeDasharray="3 3" />
              <text x={x(today) - 3} y={H - 3} fontSize={9.5} textAnchor="end" fill="var(--accent-ink)">{dt("сегодня", "today")}</text>
              {lanes.map(([k, n], i) => {
                const cy = TOP + i * LANE + LANE / 2;
                const color = colors.get(k) ?? "var(--mkt-s0)";
                const own = bundle.locations.filter((l) => l.chain_key === k);
                return (
                  <g key={k}>
                    <line x1={LABEL} x2={W - RIGHT} y1={cy} y2={cy} stroke="var(--line)" strokeDasharray="1 3" />
                    <text x={4} y={cy + 4} fontSize={11.5} fill="var(--ink)">{name.get(k) ?? k}</text>
                    <text x={W - 4} y={cy + 4} fontSize={10.5} textAnchor="end" fill="var(--ink-mute)" style={mono}>+{n}</text>
                    {own.map((l) => {
                      const t = l.opened ? at(l.opened) : null;
                      const marks = [];
                      if (t !== null && t >= t0) {
                        const exact = /^\d{4}-\d{2}/.test(l.opened!) && !l.opened_estimated;
                        const planned = l.status === "planned";
                        marks.push(
                          <circle
                            key="o"
                            cx={x(t)}
                            cy={cy}
                            r={5}
                            fill={exact && !planned ? color : "var(--surface)"}
                            stroke={color}
                            strokeWidth={exact && !planned ? 0 : 1.6}
                            strokeDasharray={planned ? "2 1.6" : undefined}
                          >
                            <title>{`${l.name}${l.city ? `, ${l.city}` : ""} — ${l.opened}`}</title>
                          </circle>,
                        );
                      }
                      const c = l.status === "closed" && l.closed ? at(l.closed) : null;
                      if (c !== null && c >= t0) {
                        marks.push(
                          <g key="c" stroke="var(--mkt-s8)" strokeWidth={1.8}>
                            <line x1={x(c) - 4.5} x2={x(c) + 4.5} y1={cy - 4.5} y2={cy + 4.5} />
                            <line x1={x(c) - 4.5} x2={x(c) + 4.5} y1={cy + 4.5} y2={cy - 4.5} />
                            <title>{`${l.name} — ${dt("закрыта", "closed")} ${l.closed}`}</title>
                          </g>,
                        );
                      }
                      return marks.length ? <g key={l.id}>{marks}</g> : null;
                    })}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-line p-2">
            <div className="mb-1 text-ink-mute" style={{ ...mono, fontSize: 11 }}>{dt("Открытий за год (с известной датой)", "Openings per year (with a known date)")}</div>
            <svg viewBox={`0 0 ${W} ${BAR_H}`} className="block h-auto w-full" role="img" aria-label={dt("Открытий за год", "Openings per year")}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={BAR_PAD.l} x2={W} y1={by(t)} y2={by(t)} stroke="var(--line)" />
                  <text x={BAR_PAD.l - 6} y={by(t) + 4} fontSize={10} textAnchor="end" fill="var(--ink-mute)" style={mono}>{t}</text>
                </g>
              ))}
              {bars.map((b, i) => {
                const cx = BAR_PAD.l + i * bw + bw / 2, w = Math.min(46, bw * 0.45);
                let acc = 0;
                return (
                  <g key={b.year}>
                    {[...b.byChain].map(([k, n]) => {
                      const y0 = by(acc), y1 = by(acc + n);
                      acc += n;
                      return (
                        <rect key={k} x={cx - w / 2} y={y1} width={w} height={Math.max(0, y0 - y1 - 1)} fill={colors.get(k) ?? "var(--mkt-s0)"}>
                          <title>{`${name.get(k) ?? k}: ${n}`}</title>
                        </rect>
                      );
                    })}
                    {b.total > 0 && <text x={cx} y={by(b.total) - 5} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--ink)">{b.total}</text>}
                    <text x={cx} y={BAR_H - 6} fontSize={10.5} textAnchor="middle" fill="var(--ink-mute)" style={mono}>
                      {b.year === thisYear ? dt(`${b.year} (${now.getMonth()} мес.)`, `${b.year} (${now.getMonth()} mo.)`) : b.year}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-soft" style={{ fontSize: 12 }}>
            {legend.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ background: colors.get(k) }} />
                {name.get(k) ?? k}
              </span>
            ))}
          </div>
        </>
      )}

      {evs.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {[...new Set(evs.map((e) => e.year))].map((yr) => (
            <YearCard key={yr} year={yr} items={evs.filter((e) => e.year === yr)} name={name} ru={ru} />
          ))}
        </div>
      )}
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}

function YearCard({ year, items, name, ru }: { year: number; items: ReturnType<typeof events>; name: Map<string, string>; ru: boolean }) {
  const dt = useDt();
  const [all, setAll] = useState(false);
  // Сначала то, что меняет рынок: входы, уходы, сделки; рядовые открытия — после.
  const rank = (k: EventKind) => (k === "open" ? 1 : 0);
  const shown = all ? items : [...items].sort((a, b) => rank(a.kind) - rank(b.kind)).slice(0, PER_CARD).sort((a, b) => a.date.localeCompare(b.date));
  const M = ru ? MONTHS_RU : MONTHS_EN;
  const when = (d: string) => {
    const m = /^\d{4}-(\d{2})(?:-(\d{2}))?/.exec(d);
    if (!m) return dt("год", "year");
    return m[2] ? `${Number(m[2])} ${M[Number(m[1]) - 1]}` : M[Number(m[1]) - 1];
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="mb-2 font-bold text-ink" style={{ fontSize: 18 }}>{year}</div>
      <ul className="flex flex-col gap-2">
        {shown.map((e, i) => {
          const [ruK, enK, color] = KIND[e.kind];
          return (
            <li key={`${e.date}-${i}`} className="grid grid-cols-[52px_1fr] gap-2" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
              <span className="text-ink-mute" style={{ ...mono, fontSize: 11 }}>{when(e.date)}</span>
              <span className="text-ink-soft">
                <span className="mr-1 rounded border px-1 py-px uppercase" style={{ ...mono, fontSize: 9.5, color, borderColor: color }}>{dt(ruK, enK)}</span>
                {e.chain && <b className="text-ink">{name.get(e.chain) ?? e.chain}</b>}
                {e.chain ? " — " : ""}
                {withoutBrand(e.text, e.chain ? name.get(e.chain) : undefined)}
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > PER_CARD && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-accent-ink" style={{ fontSize: 12 }}>
          {all ? dt("Свернуть", "Collapse") : dt(`Ещё ${items.length - PER_CARD}`, `${items.length - PER_CARD} more`)}
        </button>
      )}
    </div>
  );
}
