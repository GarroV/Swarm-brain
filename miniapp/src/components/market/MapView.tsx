"use client";
// Холст карты: подложка (SVG) → хитмап (canvas) → точки (SVG) → подписи городов (HTML).
// Зум колесом и кнопками, сдвиг перетаскиванием — переписыванием viewBox, как в референсе:
// один источник координат для всех слоёв, без CSS-трансформаций.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketLocation } from "@/types";
import { project, type Shape } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { CityLabels, MapBaseLayers, useElementWidth } from "./MapBase";
import { drawHeat, type ViewBox } from "./heat";

export type MapMode = "heat" | "dots" | "both";

const WHEEL_STEP = 1.2, BUTTON_STEP = 1.5, MIN_VB = 20, DRAG_PX = 3, HOVER_PX = 14;
const VERIF: Record<string, [string, string]> = {
  official: ["официально", "official"],
  confirmed: ["проверено", "confirmed"],
  corrected: ["исправлено", "corrected"],
  added: ["добавлено вручную", "added manually"],
  unverified: ["не проверено", "unverified"],
  internal: ["данные Dodo", "Dodo data"],
};

export function clampVb(vb: ViewBox, shape: Shape): ViewBox {
  const w = Math.max(MIN_VB, Math.min(shape.W * 1.2, vb.w));
  const h = (w * shape.H) / shape.W;
  return {
    w,
    h,
    x: Math.max(-w * 0.1, Math.min(shape.W - w * 0.9, vb.x)),
    y: Math.max(-h * 0.1, Math.min(shape.H - h * 0.9, vb.y)),
  };
}

type Props = {
  shape: Shape;
  locs: MarketLocation[];
  colors: Map<string, string>;
  chainName: Map<string, string>;
  bakery: ReadonlySet<string>;
  mode: MapMode;
  vb: ViewBox;
  setVb: (f: (vb: ViewBox) => ViewBox) => void;
  country: string;
};

type Hover = { kind: "dot"; loc: MarketLocation } | { kind: "heat"; n: number; byChain: Array<[string, number]> };

export function MapView({ shape, locs, colors, chainName, bakery, mode, vb, setVb, country }: Props) {
  const dt = useDt();
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const pts = useMemo(() => locs.map((l) => [l, project(shape.proj, l.lat, l.lng)] as const), [locs, shape]);
  const unit = width ? vb.w / width : 1; // единиц карты на экранный пиксель

  // Перерисовка хитмапа — раз в кадр, сколько бы раз ни поменялись вид и точки.
  useEffect(() => {
    if (mode === "dots" || !canvas.current) return;
    const id = requestAnimationFrame(() =>
      drawHeat(
        canvas.current!,
        pts.map(([l, [x, y]]) => ({ x, y, weight: bakery.has(l.chain_key) ? 0.45 : 1 })),
        vb,
        shape.W,
      )
    );
    return () => cancelAnimationFrame(id);
  }, [pts, vb, mode, width, shape.W, bakery]);

  // Колесо — с preventDefault, поэтому слушатель не пассивный и вешается руками.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = e.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      setVb((v) => {
        const mx = v.x + ((e.clientX - r.left) / r.width) * v.w, my = v.y + ((e.clientY - r.top) / r.height) * v.h;
        return clampVb({ x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, w: v.w * k, h: v.h * k }, shape);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [boxRef, setVb, shape]);

  const zoom = (k: number) =>
    setVb((v) => clampVb({ x: v.x + (v.w - v.w * k) / 2, y: v.y + (v.h - v.h * k) / 2, w: v.w * k, h: v.h * k }, shape));

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      d.moved = true;
      setHover(null);
      setVb(() => clampVb({ ...d.vb, x: d.vb.x - dx * unit, y: d.vb.y - dy * unit }, shape));
      return;
    }
    if (mode === "dots" || !boxRef.current) return;
    // В хитмапе подсказка — сколько точек под курсором и каких сетей.
    const r = boxRef.current.getBoundingClientRect();
    const mx = vb.x + (e.clientX - r.left) * unit, my = vb.y + (e.clientY - r.top) * unit;
    const near = pts.filter(([, [x, y]]) => Math.hypot(x - mx, y - my) <= HOVER_PX * unit);
    if (!near.length) return setHover((h) => (h?.kind === "heat" ? null : h));
    const by = new Map<string, number>();
    for (const [l] of near) by.set(l.chain_key, (by.get(l.chain_key) ?? 0) + 1);
    setHover({ kind: "heat", n: near.length, byChain: [...by].sort((a, b) => b[1] - a[1]) });
  };
  const onUp = () => {
    drag.current = null;
  };

  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  const dots = mode !== "heat";
  return (
    <div
      ref={boxRef}
      className="relative w-full touch-none select-none overflow-hidden rounded-lg border border-line"
      style={{ aspectRatio: `${shape.W} / ${shape.H}`, cursor: drag.current?.moved ? "grabbing" : "grab" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => {
        onUp();
        setHover(null);
      }}
    >
      <svg viewBox={viewBox} className="absolute inset-0 block h-full w-full" aria-hidden>
        <MapBaseLayers shape={shape} clipId={`mkt-clip-${country}`} unit={unit} />
      </svg>
      {mode !== "dots" && <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />}
      <svg viewBox={viewBox} className="absolute inset-0 block h-full w-full" role="img" aria-label={dt("Карта точек", "Locations map")}>
        {dots &&
          [...pts].sort(([a], [b]) => Number(bakery.has(b.chain_key)) - Number(bakery.has(a.chain_key))).map(([l, [x, y]]) => {
            const small = bakery.has(l.chain_key);
            const color = colors.get(l.chain_key) ?? "var(--mkt-s0)";
            const planned = l.status === "planned";
            return (
              <circle
                key={l.id}
                cx={x}
                cy={y}
                r={(small ? 2.6 : 4.4) * unit}
                fill={planned || l.opened_estimated ? "var(--map-country)" : color}
                stroke={planned || l.opened_estimated ? color : "var(--map-country)"}
                strokeWidth={(planned || l.opened_estimated ? 1.3 : 0.8) * unit}
                strokeDasharray={planned ? `${2 * unit} ${1.5 * unit}` : undefined}
                opacity={l.status === "paused" ? 0.35 : 1}
                onPointerEnter={() => !drag.current && setHover({ kind: "dot", loc: l })}
                onPointerLeave={() => setHover((h) => (h?.kind === "dot" && h.loc.id === l.id ? null : h))}
              />
            );
          })}
      </svg>
      {width > 0 && <CityLabels shape={shape} width={width} vb={vb} />}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[["+", 1 / BUTTON_STEP], ["−", BUTTON_STEP]].map(([label, k]) => (
          <button
            key={label as string}
            type="button"
            aria-label={label === "+" ? dt("Приблизить", "Zoom in") : dt("Отдалить", "Zoom out")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => zoom(k as number)}
            className="size-8 rounded-md border border-line bg-card text-ink shadow-sm hover:bg-accent-soft"
            style={{ fontSize: 16 }}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-card/80 px-1.5 text-ink-mute" style={{ fontSize: 10 }}>
        {dt("Границы: Natural Earth", "Borders: Natural Earth")}
      </span>
      {hover && <Tooltip hover={hover} chainName={chainName} colors={colors} />}
    </div>
  );
}

function Tooltip({ hover, chainName, colors }: { hover: Hover; chainName: Map<string, string>; colors: Map<string, string> }) {
  const dt = useDt();
  const box = "pointer-events-none absolute left-2 top-2 max-w-[260px] rounded-lg border border-line bg-card p-2.5 shadow-sm";
  if (hover.kind === "heat") {
    return (
      <div className={box} style={{ fontSize: 12 }}>
        <div className="font-semibold text-ink">{dt(`${hover.n} точ. в радиусе курсора`, `${hover.n} locations under the cursor`)}</div>
        {hover.byChain.slice(0, 8).map(([k, n]) => (
          <div key={k} className="flex items-center gap-1.5 text-ink-soft">
            <span className="inline-block size-2 rounded-full" style={{ background: colors.get(k) }} />
            {chainName.get(k) ?? k} <span className="text-ink-mute">{n}</span>
          </div>
        ))}
      </div>
    );
  }
  const l = hover.loc;
  return (
    <div className={box} style={{ fontSize: 12 }}>
      <div className="font-semibold text-ink">{l.name}</div>
      <div className="text-ink-soft">{[chainName.get(l.chain_key), l.city].filter(Boolean).join(" · ")}</div>
      {l.address && <div className="text-ink-soft">{l.address}</div>}
      <div className="text-ink-mute">
        {dt("Открытие", "Opened")}: {l.opened ?? "—"}
        {l.opened_estimated ? dt(" (оценка)", " (estimated)") : ""}
      </div>
      {l.status !== "open" && (
        <div className="text-ink-mute">
          {l.status === "closed" ? dt("закрыта", "closed") : l.status === "planned" ? dt("анонс", "announced") : dt("пауза", "paused")}
          {l.closed ? ` ${l.closed}` : ""}
        </div>
      )}
      {l.format && <div className="text-ink-mute">{l.format}</div>}
      <div className="text-ink-mute">{VERIF[l.verification] ? dt(...VERIF[l.verification]) : l.verification}</div>
    </div>
  );
}
