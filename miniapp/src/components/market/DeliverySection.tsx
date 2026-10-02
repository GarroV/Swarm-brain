"use client";
// «Доставка» эталона: слева столбцы выручки платформ по годам (ручная часть delivery_platforms),
// справа «Ключевые цифры» (delivery_figures). Без ручной части — ключевые цифры и наблюдения
// из фактов ручной заливки (topic delivery / insight) в той же разметке; нет ничего — секции нет.
import { type PointerEvent, useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import type { EdPlatform } from "@/lib/marketEditorial";
import { factCards } from "@/lib/marketInsights";
import { useDt, useLang } from "@/components/roy/nav";
import { dec, RefSection, Sw, useEditorial, useTip } from "./ref";
import { firstUrl, SourceCaption } from "./ui";

const KEY_FIGURES = 6;
const INSIGHTS = 4;
const FIRST_YEAR = 2021;
const PROFIT = /profit|loss|dobit|gubit|прибыл|убыт/i;
// Геометрия графика эталона: 520×230, слева под подписи шкалы 30, сверху 14, снизу 24, шаг шкалы 10 млн.
const W = 520, H = 230, L = 30, BT = 14, BB = 24, BW = 22, GAP = 2, STEP = 10e6;

const statStyle = { display: "grid", gridTemplateColumns: "130px 1fr", gap: 10, alignItems: "baseline" } as const;

function PlatformChart({ platforms }: { platforms: EdPlatform[] }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const tip = useTip();
  const last = Math.max(...platforms.flatMap((p) => p.years.map((y) => y.year)));
  const first = Math.min(FIRST_YEAR, last);
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const max = Math.max(...platforms.flatMap((p) => p.years.filter((y) => y.year >= first).map((y) => y.revenue_eur)));
  const mx = Math.max(STEP, Math.ceil(max / STEP) * STEP);
  const ticks = Array.from({ length: mx / STEP + 1 }, (_, i) => i * STEP);
  const Y = (v: number) => H - BB - (v / mx) * (H - BT - BB);
  const gw = (W - L) / years.length;
  const n = platforms.length;
  const get = (p: EdPlatform, y: number) => p.years.find((x) => x.year === y)?.revenue_eur ?? null;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
            <text x={L - 6} y={Y(v) + 4} textAnchor="end">{v / 1e6}</text>
          </g>
        ))}
        {years.map((y, i) => {
          const x0 = L + i * gw + (gw - BW * n - GAP * (n - 1)) / 2;
          return (
            <g key={y}>
              {platforms.map((p, j) => {
                const v = get(p, y);
                if (!v) return null;
                const show = (e: PointerEvent) => tip.show(<><b>{p.name}, {y}</b><br />€{dec(v / 1e6, 1, ru)} {dt("млн", "M")}</>, e);
                return (
                  <rect key={p.name} x={x0 + j * (BW + GAP)} y={Y(v)} width={BW} height={Y(0) - Y(v)} rx={2} fill={`var(--s${p.slot})`} onPointerMove={show} onPointerLeave={tip.hide} />
                );
              })}
              <text x={L + i * gw + gw / 2} y={H - 6} textAnchor="middle">{y}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {platforms.map((p) => (
          <span key={p.name}><Sw color={`var(--s${p.slot})`} />{p.name}{p.note ? ` (${p.note})` : ""}</span>
        ))}
      </div>
    </>
  );
}

type Stat = { big: string; text: string; href: string | null };

export function DeliverySection({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const ed = useEditorial(bundle);
  const now = useMemo(() => new Date(), []);
  const [allInsights, setAllInsights] = useState(false);
  const manual = ed.deliveryFigures.length > 0;
  // Ключевые цифры: ручные — как есть; без них — первая цифра свежих фактов доставки.
  const figures = useMemo<Stat[]>(() => {
    if (manual) return ed.deliveryFigures.map((f) => ({ big: f.big, text: f.text, href: null }));
    return factCards(bundle.facts.filter((f) => f.topic === "delivery" && !PROFIT.test(`${f.value} ${f.text}`)), now, ru)
      .slice(0, KEY_FIGURES)
      .map((c) => ({ big: c.head, text: c.more ? `${c.more}. ${c.text}` : c.text, href: firstUrl(c.source) }));
  }, [manual, ed.deliveryFigures, bundle.facts, now, ru]);
  const insights = useMemo(() => (manual ? [] : bundle.facts.filter((f) => f.topic === "insight" && !PROFIT.test(f.text))), [manual, bundle.facts]);
  const platforms = ed.platforms;
  if (!platforms.length && !figures.length && !insights.length) return null;

  const shown = allInsights ? insights : insights.slice(0, INSIGHTS);
  const lede = ed.texts.delivery ?? dt(
    "Площадки сами число заказов не публикуют. Цифры — из отчётности их местных юрлиц, публикаций и оценок; выручка площадки — это в основном комиссии, а не сумма заказов. Тексты — на языке источника.",
    "Platforms do not publish order counts. Figures come from their local entities' filings, press and estimates; platform revenue is mostly commissions, not order value.",
  );
  const feeds: Array<"facts" | "editorial"> = platforms.length || manual ? ["editorial", "facts"] : ["facts"];

  return (
    <RefSection id="delivery" eyebrow={dt("Доставка", "Delivery")} title={ed.texts.delivery_title ?? dt("Рынок агрегаторов", "Delivery aggregator market")} lede={lede}>
      <div className="pgrid">
        {platforms.length > 0 && (
          <div className="panel chartbox">
            <h3>{ed.texts.delivery_chart_title ?? dt("Выручка платформ, € млн", "Platform revenue, € m")}</h3>
            <PlatformChart platforms={platforms} />
          </div>
        )}
        {figures.length > 0 && (
          <div className="panel chartbox">
            <h3>{dt("Ключевые цифры", "Key figures")}</h3>
            {figures.map((f, i) => (
              <div key={i} className="stat" style={statStyle}>
                <b style={{ fontSize: 18 }}>{f.big}</b>
                <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                  {f.text}
                  {f.href && <> <a href={f.href} target="_blank" rel="noopener noreferrer">↗</a></>}
                </span>
              </div>
            ))}
          </div>
        )}
        {insights.length > 0 && (
          <div className="panel chartbox">
            <h3>{dt("Наблюдения", "Observations")}</h3>
            {shown.map((f, i) => {
              const url = firstUrl(f.source);
              return (
                <div key={i} className="stat">
                  <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                    {f.text}
                    {url && <> <a href={url} target="_blank" rel="noopener noreferrer">↗</a></>}
                  </span>
                </div>
              );
            })}
            {insights.length > INSIGHTS && (
              <button type="button" className="small" style={{ alignSelf: "flex-start" }} onClick={() => setAllInsights((v) => !v)}>
                {allInsights ? dt("Свернуть", "Show less") : dt(`Ещё ${insights.length - INSIGHTS}`, `${insights.length - INSIGHTS} more`)}
              </button>
            )}
          </div>
        )}
      </div>
      <SourceCaption bundle={bundle} feeds={feeds} />
    </RefSection>
  );
}
