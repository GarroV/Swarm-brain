"use client";
// Подложка карты страны: море, соседи, страна с регионами, озёра, реки и подписи городов.
// Геометрия рисуется один раз генератором scripts/market/build-shapes.ts (Natural Earth 10m)
// и лежит в public/market/shapes/<CC>.json; здесь только раскраска токенами темы.
import { useEffect, useRef, useState } from "react";
import type { Shape } from "@/lib/marketView";
import type { ViewBox } from "./heat";

/** Слои под точками. `clipId` — контур страны, по нему обрезается режим «Плотность»; `unit` —
 *  единиц viewBox на экранный пиксель (кружки городов). Толщина линий — экранная
 *  (non-scaling-stroke): на телефоне граница не истончается до невидимой. */
export function MapBaseLayers({ shape, clipId, unit }: { shape: Shape; clipId: string; unit: number }) {
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={shape.path} clipRule="evenodd" />
        </clipPath>
      </defs>
      <rect width={shape.W} height={shape.H} fill="var(--map-sea)" />
      {shape.land && <path d={shape.land} fill="var(--map-land)" stroke="var(--map-border)" strokeWidth={0.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      <path d={shape.path} fill="var(--map-country)" fillRule="evenodd" />
      {shape.regions && (
        <path d={shape.regions} fill="none" stroke="var(--map-region)" strokeWidth={0.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${clipId})`} />
      )}
      {shape.lakes && <path d={shape.lakes} fill="var(--map-sea)" stroke="var(--map-water-edge)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />}
      {shape.rivers && (
        <path
          d={shape.rivers}
          fill="none"
          stroke="var(--map-river)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${clipId})`}
        />
      )}
      <path d={shape.path} fill="none" stroke="var(--map-outline)" strokeWidth={1} strokeLinejoin="round" fillRule="evenodd" vectorEffect="non-scaling-stroke" />
      {(shape.cities ?? []).map((c) => (
        <circle
          key={c.name}
          cx={c.x}
          cy={c.y}
          r={(c.capital ? 3 : 2) * unit}
          fill={c.capital ? "var(--map-city)" : "var(--map-country)"}
          stroke="var(--map-city)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

/** Ширина элемента в CSS-пикселях: карта масштабируется под экран, а размер точек и подписей
 *  должен оставаться экранным, иначе на телефоне точка ужимается до полутора пикселей. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const LABEL_PX = 11;
const NARROW_PX = 520; // уже — карта телефонная, подписей не больше NARROW_LABELS
const NARROW_LABELS = 5;
const CHAR_PX = 6.2; // средняя ширина символа подписи; точность не нужна — нужен запас от слипания

/** Подписи городов — HTML поверх карты: в SVG шрифт уменьшался бы вместе с картой и на
 *  телефоне становился нечитаемым. Подпись, которая налезает на более крупный город, не
 *  показывается: на узкой карте остаются столица и пара крупнейших. */
export function CityLabels({ shape, width, vb }: { shape: Shape; width: number; vb: ViewBox }) {
  const scale = width / vb.w;
  const height = (vb.h * width) / vb.w;
  const limit = width < NARROW_PX && vb.w >= shape.W ? NARROW_LABELS : Infinity;
  const at = (c: { x: number; y: number }) => [(c.x - vb.x) * scale, (c.y - vb.y) * scale] as const;
  const placed: Array<[number, number, number, number]> = [];
  const shown = width
    ? [...(shape.cities ?? [])].sort((a, b) => Number(b.capital) - Number(a.capital) || a.rank - b.rank).filter((c) => {
      const w = c.name.length * CHAR_PX + 6, h = LABEL_PX + 4;
      const [cx, cy] = at(c);
      const x = cx + 5, y = cy - h / 2;
      if (placed.length >= limit || x < 0 || x + w > width || y < 0 || y + h > height) return false;
      if (placed.some(([px, py, pw, ph]) => x < px + pw && x + w > px && y < py + ph && y + h > py)) return false;
      placed.push([x, y, w, h]);
      return true;
    })
    : [];

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {shown.map((c) => (
        <span
          key={c.name}
          className="absolute whitespace-nowrap text-ink-soft"
          style={{
            left: at(c)[0] + 5,
            top: at(c)[1],
            transform: "translateY(-50%)",
            fontSize: LABEL_PX,
            fontWeight: c.capital ? 600 : 450,
            color: c.capital ? "var(--ink)" : undefined,
            textShadow: "0 0 2px var(--map-country), 0 0 2px var(--map-country), 0 0 3px var(--map-country)",
          }}
        >
          {c.name}
        </span>
      ))}
    </div>
  );
}

/** Подложка страны: один запрос на страну на всю сессию, общий для карты и тренда. */
const shapeCache = new Map<string, Promise<Shape>>();
export function useShape(country: string): { shape: Shape | null; failed: boolean } {
  const [state, setState] = useState<{ country: string; shape: Shape | null; failed: boolean }>({ country, shape: null, failed: false });
  useEffect(() => {
    let alive = true;
    if (!shapeCache.has(country)) {
      shapeCache.set(
        country,
        fetch(`/market/shapes/${country}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      );
    }
    shapeCache.get(country)!
      .then((shape) => alive && setState({ country, shape, failed: false }))
      .catch((e) => {
        console.error("[market] shape", country, e);
        shapeCache.delete(country);
        if (alive) setState({ country, shape: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [country]);
  return state.country === country ? state : { shape: null, failed: false };
}
