"use client";
// Динамика сетей: число работающих точек на конец года (из реестра точек) и таймлайн
// открытий/закрытий по годам. Считается на экране, в базе не хранится.
import { useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { unitsByYear } from "@/lib/marketStats";
import { segmentColor } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { Chip, mono, Section, SourceCaption } from "./ui";

const FROM_YEAR = 2021;
const TOP = 8;
const W = 640, H = 220, PAD = { l: 34, r: 12, t: 10, b: 24 };

export function ChainDynamics({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: thisYear - FROM_YEAR + 1 }, (_, i) => FROM_YEAR + i), [thisYear]);
  const locs = useMemo(
    () => bundle.locations.map((l) => ({ chain: l.chain_key, opened: l.opened, status: l.status, closed: l.closed })),
    [bundle.locations],
  );
  const series = useMemo(() => unitsByYear(locs, bundle.chains.map((c) => c.key), years), [locs, bundle.chains, years]);
  const ranked = useMemo(
    () => [...bundle.chains].sort((a, b) => (series[b.key]?.at(-1) ?? 0) - (series[a.key]?.at(-1) ?? 0)),
    [bundle.chains, series],
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const shown = picked ?? new Set(ranked.slice(0, TOP).map((c) => c.key));

  const timeline = useMemo(() =>
    years.map((y) => ({
      y,
      opened: bundle.locations.filter((l) => Number(l.opened?.slice(0, 4)) === y).length,
      closed: bundle.locations.filter((l) => l.status === "closed" && Number(l.closed?.slice(0, 4)) === y).length,
    })), [bundle.locations, years]);

  if (!bundle.locations.length) return null;
  const max = Math.max(1, ...ranked.filter((c) => shown.has(c.key)).flatMap((c) => series[c.key] ?? []));
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, years.length - 1);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const tlMax = Math.max(1, ...timeline.flatMap((t) => [t.opened, t.closed]));
  const toggle = (k: string) => {
    const n = new Set(shown);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setPicked(n);
  };

  return (
    <Section title={dt("Динамика сетей", "Chain dynamics")}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ranked.map((c) => (
          <Chip key={c.key} active={shown.has(c.key)} onClick={() => toggle(c.key)} color={segmentColor(c.segment)}>
            {c.name}
          </Chip>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={dt("Точек на конец года", "Units at year end")}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" />
            <text x={PAD.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize={10} fill="var(--ink-mute)" style={mono}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {years.map((yr, i) => (
          <text key={yr} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-mute)" style={mono}>{yr}</text>
        ))}
        {ranked.filter((c) => shown.has(c.key)).map((c) => {
          const v = series[c.key] ?? [];
          const color = segmentColor(c.segment);
          return (
            <g key={c.key}>
              <polyline
                points={v.map((n, i) => `${x(i)},${y(n)}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={c.key === "dodo" ? 2.6 : 1.6}
                strokeDasharray={c.key === "dodo" ? undefined : c.slot % 2 ? undefined : "4 3"}
              >
                <title>{`${c.name}: ${v.join(" → ")}`}</title>
              </polyline>
              <text x={x(v.length - 1) + 3} y={y(v.at(-1) ?? 0) - 3} fontSize={10} fill={color}>{c.name}</text>
            </g>
          );
        })}
      </svg>

      <h3 className="mb-2 mt-4 text-ink-soft" style={{ fontSize: 13 }}>{dt("Открытия и закрытия по годам", "Openings and closures by year")}</h3>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${timeline.length}, minmax(0, 1fr))` }}>
        {timeline.map((t) => (
          <div key={t.y} className="flex flex-col items-center gap-0.5" title={`${t.y}: +${t.opened} / −${t.closed}`}>
            <div className="flex h-16 items-end gap-0.5">
              <div className="w-2.5 rounded-sm" style={{ height: `${(t.opened / tlMax) * 100}%`, background: "var(--chart-3)" }} />
              <div className="w-2.5 rounded-sm" style={{ height: `${(t.closed / tlMax) * 100}%`, background: "var(--chart-5)" }} />
            </div>
            <span className="text-ink-mute" style={{ ...mono, fontSize: 10 }}>{t.y}</span>
            <span className="text-ink-soft" style={{ ...mono, fontSize: 10 }}>+{t.opened} −{t.closed}</span>
          </div>
        ))}
      </div>
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}
