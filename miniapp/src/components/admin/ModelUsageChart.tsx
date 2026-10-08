"use client";
import { useState } from "react";
import { Segmented } from "@/components/roy/ui";
import { useDt, useLang } from "@/components/roy/nav";
import { bucketLabel, type UsageGrain } from "@/lib/usageBuckets";
import type { StackedBucket } from "@/lib/usageCube";

// График «Расход по времени» (#822): столбцы по назначениям (у каждого свой цвет, легенда под
// графиком), подписи дат под осью, при наведении — подсказка с разбивкой, щелчок по столбцу
// сужает период экрана до этого столбца.

const GRAINS: Array<[UsageGrain, string, string]> = [["day", "День", "Day"], ["week", "Неделя", "Week"], ["month", "Месяц", "Month"]];
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** Сколько подписей помещается под осью: остальные столбцы без подписи, чтобы текст не налезал. */
const MAX_LABELS = 8;

export const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

export function ModelUsageChart({ buckets, series, seriesName, grain, onGrain, onPick }: {
  buckets: StackedBucket[];
  series: string[];
  seriesName: (key: string) => string;
  grain: UsageGrain;
  onGrain: (g: UsageGrain) => void;
  /** Щелчок по столбцу: период экрана — этот столбец. */
  onPick: (b: StackedBucket) => void;
}) {
  const dt = useDt();
  const lang = useLang();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...buckets.map((b) => b.usd), 0.000001);
  const every = Math.max(1, Math.ceil(buckets.length / MAX_LABELS));
  const hovered = hover === null ? null : buckets[hover];
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-ink" style={{ fontSize: 13.5 }}>{dt("Расход по времени", "Spend over time")}</h3>
        <div className="w-[210px]">
          <Segmented items={GRAINS.map(([id, ru, en]) => ({ id, label: dt(ru, en) }))} value={grain} onChange={(id) => onGrain(id as UsageGrain)} />
        </div>
      </div>
      <div className="relative">
        <div className="flex items-start gap-2">
          <span className="w-[52px] shrink-0 text-right font-mono text-ink-mute" style={{ fontSize: 10.5 }}>{usd(max)}</span>
          <div className="flex h-[150px] flex-1 items-end gap-[3px] border-b border-l border-line pl-[3px]"
            onMouseLeave={() => setHover(null)}>
            {buckets.map((b, i) => (
              <button key={b.start} type="button"
                aria-label={`${bucketLabel(b, grain, lang)}: ${usd(b.usd)}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onClick={() => onPick(b)}
                className="flex h-full min-w-[4px] flex-1 flex-col-reverse rounded-t-[3px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ background: hover === i ? "var(--surface-2)" : undefined }}>
                {b.usd > 0
                  ? b.parts.map((p, k) => p > 0 && (
                    <div key={series[k]} style={{ height: `${(p / max) * 100}%`, minHeight: 1, background: COLORS[k % COLORS.length] }} />
                  ))
                  : <div style={{ height: 1, background: "var(--line)" }} />}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-[63px] mt-1 flex gap-[3px] text-ink-mute" style={{ fontSize: 10.5 }}>
          {buckets.map((b, i) => (
            <div key={b.start} className="min-w-[4px] flex-1 overflow-visible whitespace-nowrap">
              {i % every === 0 ? bucketLabel(b, grain, lang) : ""}
            </div>
          ))}
        </div>
        {hovered && (
          <div role="status" className="pointer-events-none absolute top-0 z-10 rounded-[8px] border border-line bg-surface px-2.5 py-2 shadow-sm"
            style={{ fontSize: 12, minWidth: 180, ...tipSide(hover!, buckets.length) }}>
            <div className="font-semibold text-ink">{bucketLabel(hovered, grain, lang)} · {usd(hovered.usd)} · {hovered.calls}</div>
            {hovered.parts.map((p, k) => p > 0 && (
              <div key={series[k]} className="flex items-center justify-between gap-3 text-ink-soft">
                <span className="flex items-center gap-1.5"><Swatch k={k} />{seriesName(series[k])}</span>
                <span className="font-mono">{usd(p)}</span>
              </div>
            ))}
            {grain !== "day" || hovered.start !== hovered.end
              ? <div className="mt-1 text-ink-mute" style={{ fontSize: 11 }}>{dt("Щелчок — показать этот отрезок", "Click to zoom in")}</div>
              : null}
          </div>
        )}
      </div>
      {series.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-soft" style={{ fontSize: 12 }}>
          {series.map((s, k) => <span key={s} className="flex items-center gap-1.5"><Swatch k={k} />{seriesName(s)}</span>)}
        </div>
      )}
    </section>
  );
}

// Подсказка — над наведённым столбцом: в левой половине графика открывается вправо от него, в правой — влево.
function tipSide(i: number, n: number): { left: string } | { right: string } {
  const pct = ((i + 0.5) / n) * 100;
  return pct < 50 ? { left: `calc(60px + ${pct}% * 0.95)` } : { right: `${(100 - pct) * 0.95}%` };
}

function Swatch({ k }: { k: number }) {
  return <span aria-hidden className="inline-block h-[9px] w-[9px] rounded-[2px]" style={{ background: COLORS[k % COLORS.length] }} />;
}
