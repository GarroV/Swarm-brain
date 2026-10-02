"use client";
// Холст карты как .mapbox эталона: подложка (SVG) → хитмап (canvas) → точки и подписи городов
// (SVG). Зум колесом и кнопками, сдвиг перетаскиванием — переписыванием viewBox: один источник
// координат для всех слоёв. Подсказки — общая .tip страницы (useTip).
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { MarketLocation } from "@/types";
import { makeVb, nearByChain, type ViewBox } from "@/lib/marketMap";
import { project, type Shape } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { CityLabels, MapBaseLayers, useElementWidth } from "./MapBase";
import { drawHeat } from "./heat";
import { fmtDate, useTip } from "./ref";

export type MapMode = "heat" | "dots" | "both";

const WHEEL_STEP = 1.2, BUTTON_STEP = 1.5, HOVER_PX = 14;
const R_DOT = 4.4, R_BAKERY = 2.6, PAUSED_OPACITY = 0.35;
const STATUS: Record<MarketLocation["status"], [string, string]> = {
  open: ["Работает", "Open"],
  closed: ["Закрыта", "Closed"],
  planned: ["Анонс", "Announced"],
  paused: ["Приостановлена", "Paused"],
};

type Props = {
  shape: Shape;
  locs: MarketLocation[];
  col: (key: string) => string;
  chainName: Map<string, string>;
  bakery: ReadonlySet<string>;
  mode: MapMode;
  vb: ViewBox;
  setVb: (f: (vb: ViewBox) => ViewBox) => void;
};

/** Смена темы — класс .dark на <html>: хитмап перекрашивается новой шкалой. */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return tick;
}

export function MapView({ shape, locs, col, chainName, bakery, mode, vb, setVb }: Props) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const tip = useTip();
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);
  const [dragging, setDragging] = useState(false);
  const theme = useThemeTick();
  const pts = useMemo(() => locs.map((l) => [l, project(shape.proj, l.lat, l.lng)] as const), [locs, shape]);
  const unit = width ? vb.w / width : 1; // единиц карты на экранный пиксель (1 / screenScale эталона)

  // Перерисовка хитмапа — раз в кадр; в режиме «Точки» холст просто очищается.
  useEffect(() => {
    if (!canvas.current) return;
    const heat = mode === "dots" ? [] : pts.map(([l, [x, y]]) => ({ x, y, bakery: bakery.has(l.chain_key) }));
    const id = requestAnimationFrame(() => canvas.current && drawHeat(canvas.current, heat, vb, shape.W));
    return () => cancelAnimationFrame(id);
  }, [pts, vb, mode, width, shape.W, bakery, theme]);

  // Колесо — с preventDefault, поэтому слушатель не пассивный и вешается руками.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      const k = e.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      setVb((v) => {
        const nw = makeVb(0, 0, v.w * k, shape.W, shape.H).w, nh = (nw * shape.H) / shape.W;
        return makeVb(v.x + fx * (v.w - nw), v.y + fy * (v.h - nh), nw, shape.W, shape.H);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [boxRef, setVb, shape]);

  const zoom = (k: number) =>
    setVb((v) => {
      const nw = v.w * k;
      return makeVb(v.x + (v.w - nw) / 2, v.y + (v.h - (nw * shape.H) / shape.W) / 2, nw, shape.W, shape.H);
    });

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, vb };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      setVb(() => ({ ...d.vb, x: d.vb.x - dx * unit, y: d.vb.y - dy * unit }));
      return;
    }
    if (mode === "heat") return heatTip(e);
    const c = (e.target as Element).closest("circle[data-i]");
    if (c) tip.show(locTip(pts[Number(c.getAttribute("data-i"))][0]), e);
    else tip.hide();
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  // В хитмапе подсказка — сколько точек в радиусе курсора и каких сетей.
  const heatTip = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = vb.x + (e.clientX - r.left) * unit, my = vb.y + (e.clientY - r.top) * unit;
    const near = nearByChain(pts.map(([l, [x, y]]) => ({ x, y, chain: l.chain_key })), mx, my, HOVER_PX * unit);
    if (!near.n) return tip.hide();
    tip.show(
      <>
        <b>{dt(`${near.n} точ.`, `${near.n} loc.`)}</b> {dt("в радиусе курсора", "within the cursor radius")}
        {near.byChain.map(([k, v]) => (
          <span key={k}>
            <br />
            <span className="k">{chainName.get(k) ?? k}</span> {v}
          </span>
        ))}
      </>,
      e,
    );
  };

  const locTip = (l: MarketLocation): ReactNode => (
    <>
      <b>{l.name}</b>
      <br />
      <span className="k">{[chainName.get(l.chain_key) ?? l.chain_key, l.city].filter(Boolean).join(" · ")}</span>
      {l.address && (
        <>
          <br />
          {l.address}
        </>
      )}
      <br />
      <span className="k">{dt("Открытие:", "Opened:")}</span> {fmtDate(l.opened, ru)}
      {l.opened_estimated ? dt(" (оценка)", " (estimate)") : ""}
      {l.status !== "open" && (
        <>
          <br />
          <span className="k">{dt("Статус:", "Status:")}</span> {dt(...STATUS[l.status])}
          {l.closed ? (l.status === "paused" ? dt(" с ", " since ") : " ") + fmtDate(l.closed, ru) : ""}
        </>
      )}
      {l.format && (
        <>
          <br />
          <span className="k">{l.format}</span>
        </>
      )}
    </>
  );

  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  // Пекарни рисуются первыми — под точками сетей.
  const dots = mode === "heat" ? [] : pts.map((p, i) => [p, i] as const).sort(([[a]], [[b]]) => Number(bakery.has(b.chain_key)) - Number(bakery.has(a.chain_key)));
  return (
    <div
      ref={boxRef}
      className={dragging ? "mapbox drag" : "mapbox"}
      style={{ aspectRatio: `${shape.W} / ${shape.H}` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => tip.hide()}
    >
      <svg viewBox={viewBox} aria-hidden>
        <MapBaseLayers shape={shape} />
      </svg>
      <canvas ref={canvas} />
      <svg viewBox={viewBox} role="img" aria-label={dt("Карта ресторанов сетей", "Map of chain restaurants")}>
        <g style={{ display: mode === "heat" ? "none" : undefined }}>
          {dots.map(([[l, [x, y]], i]) => {
            const small = bakery.has(l.chain_key);
            const c = col(l.chain_key);
            const planned = l.status === "planned";
            return (
              <circle
                key={l.id}
                data-i={i}
                cx={x}
                cy={y}
                r={(small ? R_BAKERY : R_DOT) * unit}
                fillOpacity={l.status === "paused" ? PAUSED_OPACITY : 1}
                fill={planned ? "var(--surface)" : c}
                stroke={planned ? c : "var(--surface)"}
                strokeWidth={(planned ? 1.6 : 1) * unit}
                strokeDasharray={planned ? `${2 * unit} ${1.5 * unit}` : undefined}
              />
            );
          })}
        </g>
        {width > 0 && <CityLabels shape={shape} unit={unit} />}
      </svg>
      <div className="zoombtns">
        <button type="button" aria-label={dt("Приблизить", "Zoom in")} onClick={() => zoom(1 / BUTTON_STEP)}>+</button>
        <button type="button" aria-label={dt("Отдалить", "Zoom out")} onClick={() => zoom(BUTTON_STEP)}>−</button>
      </div>
      <div className="mapnote">{dt("Границы: Natural Earth", "Borders: Natural Earth")}</div>
    </div>
  );
}
