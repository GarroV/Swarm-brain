"use client";
import { useState } from "react";

// Линия «моя подборка» против IMF с полосой нормы. Одна ось, подписи значений только у
// последней точки; остальное — по наведению (вертикальная линия + подсказка).

type Props = {
  labels: string[];
  mine: number[];
  imf: number[];
  norm: number;
  min: number;
  max: number;
  ticks: number[];
  fmt: (v: number) => string;
  ariaLabel: string;
  mineLabel: string;
  imfLabel: string;
};

const W = 400, H = 170, L = 30, R = 30, T = 10, B = 24;

export function LineChart({ labels, mine, imf, norm, min, max, ticks, fmt, ariaLabel, mineLabel, imfLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const y = (v: number) => T + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * (H - T - B);
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const step = Math.ceil(n / 5);
  const last = n - 1;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    setHover(Math.min(last, Math.max(0, i)));
  };

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
          <text key={lb} x={x(i)} y={H - 6} textAnchor={i === last ? "end" : "middle"} fill="currentColor">{lb}</text>
        ) : null))}
        <path d={path(imf)} fill="none" stroke="var(--ink-mute)" strokeWidth={1.5} strokeDasharray="5 4" />
        <path d={path(mine)} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(last)} cy={y(mine[last])} r={4} fill="var(--primary)" stroke="var(--surface)" strokeWidth={2} />
        {hover == null && (
          <text x={x(last) - 6} y={y(mine[last]) + (mine[last] < imf[last] ? 16 : -9)} textAnchor="end"
            fill="var(--ink)" style={{ fontWeight: 600, fontSize: 11 }}>{fmt(mine[last])}</text>
        )}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line-2)" />
            <circle cx={x(hover)} cy={y(mine[hover])} r={4} fill="var(--primary)" stroke="var(--surface)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(imf[hover])} r={3} fill="var(--ink-mute)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 rounded-[8px] border border-line-2 bg-popover px-2.5 py-1.5 text-ink shadow-md"
          style={{ fontSize: 12, left: `${(x(hover) / W) * 100}%`, transform: hover > n / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
          <div className="font-semibold">{labels[hover]}</div>
          <div className="whitespace-nowrap"><span className="text-primary">●</span> {mineLabel} <b className="font-mono">{fmt(mine[hover])}</b></div>
          <div className="whitespace-nowrap text-ink-soft"><span>●</span> {imfLabel} <b className="font-mono">{fmt(imf[hover])}</b></div>
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
