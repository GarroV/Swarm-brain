"use client";
import { useState } from "react";

// Линии подборки против IMF с полосой нормы. Одна ось; подпись значения — у последней точки
// единственной сплошной линии, при нескольких странах значения — в подсказке по наведению.

export type ChartSeries = {
  id: string;
  label: string;
  /** CSS-цвет из токенов темы (var(--chart-1) …), чтобы линия читалась в обеих темах. */
  color: string;
  /** null — в этой точке у ряда данных нет: линия рвётся. */
  values: Array<number | null>;
  /** Пунктир — сравнение (IMF), не предмет графика. */
  dashed?: boolean;
};

type Props = {
  labels: string[];
  series: ChartSeries[];
  norm: number;
  min: number;
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
  ariaLabel: string;
};

const W = 400, H = 170, L = 30, R = 30, T = 10, B = 24;

export function LineChart({ labels, series, norm, min, max, ticks, fmt, ariaLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * (H - T - B);
  // Разрыв на null: следующая точка начинает новый отрезок (M), а не тянется от пропуска.
  const path = (s: Array<number | null>) => s.map((v, i) => (v == null ? "" : `${i && s[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join("");
  const step = Math.max(1, Math.ceil(n / 5));
  const last = n - 1;
  const solid = series.filter((s) => !s.dashed);
  const lead = solid.length === 1 ? solid[0] : null;
  const leadLast = lead?.values[last] ?? null;
  const benchLast = series.find((s) => s.dashed)?.values[last] ?? null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    setHover(Math.min(last, Math.max(0, i)));
  };

  if (!n) return null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        className="block font-mono text-ink-mute" style={{ fontSize: 10 }}>
        <rect x={L} width={W - L - R} y={y(max)} height={Math.max(0, y(norm) - y(max))} fill="var(--status-done)" opacity={0.08} />
        <line x1={L} x2={W - R} y1={y(norm)} y2={y(norm)} stroke="var(--status-done)" strokeDasharray="4 4" opacity={0.7} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fill="currentColor">{fmt(t)}</text>
          </g>
        ))}
        {labels.map((lb, i) => (i % step === last % step ? (
          <text key={`${lb}-${i}`} x={x(i)} y={H - 6} textAnchor={i === last && n > 1 ? "end" : "middle"} fill="currentColor">{lb}</text>
        ) : null))}
        {series.map((s) => (
          <path key={s.id} d={path(s.values)} fill="none" stroke={s.color}
            strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round"
            className="transition-[d] duration-300" />
        ))}
        {solid.map((s) => {
          const v = s.values[last];
          return v == null ? null : <circle key={s.id} cx={x(last)} cy={y(v)} r={solid.length > 1 ? 3 : 4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
        })}
        {hover == null && leadLast != null && (
          <text x={x(last) - 6} y={y(leadLast) + (benchLast != null && leadLast < benchLast ? 16 : -9)} textAnchor="end"
            fill="var(--ink)" style={{ fontWeight: 600, fontSize: 11 }}>{fmt(leadLast)}</text>
        )}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line-2)" />
            {series.map((s) => {
              const v = s.values[hover];
              return v == null ? null : <circle key={s.id} cx={x(hover)} cy={y(v)} r={s.dashed ? 3 : 4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-[8px] border border-line-2 bg-popover px-2.5 py-1.5 text-ink shadow-md"
          style={{ fontSize: 12, left: `${(x(hover) / W) * 100}%`, transform: hover > n / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
          <div className="font-semibold">{labels[hover]}</div>
          {[...series].sort((a, b) => (b.values[hover] ?? -Infinity) - (a.values[hover] ?? -Infinity)).map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.id} className={`flex items-center gap-1.5 whitespace-nowrap ${s.dashed ? "text-ink-soft" : ""}`}>
                <span style={{ color: s.color }}>●</span> {s.label}
                <b className="ml-auto pl-3 font-mono">{v == null ? "—" : fmt(v)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Шесть волн в одну строку таблицы. */
export function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-ink-mute">—</span>;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(2 + (i * 56) / (values.length - 1)).toFixed(1)},${(16 - ((v - lo) / (hi - lo || 1)) * 14).toFixed(1)}`);
  return (
    <svg viewBox="0 0 60 18" width={60} height={18} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** Спарклайн площадью — для продаж. */
export function AreaSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => [4 + (i * 192) / (values.length - 1), 42 - ((v - lo) / (hi - lo || 1)) * 36]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const end = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 200 46" preserveAspectRatio="none" className="mt-2 block h-[46px] w-full" aria-hidden="true">
      <path d={`${d}L${end[0]},46L${pts[0][0]},46Z`} fill="var(--primary)" opacity={0.08} />
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
