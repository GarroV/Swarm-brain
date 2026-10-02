"use client";
// Подложка карты страны в виде эталона: соседи (--land2 тёплого тона против холодного моря —
// иначе суша и море сливаются; линия --land2-line .8) и своя страна (--land,
// граница --border 1.2), море — фон .mapbox. Геометрия рисуется один раз генератором
// scripts/market/build-shapes.ts (Natural Earth 10m) и лежит в public/market/shapes/<CC>.json.
import { useEffect, useRef, useState } from "react";
import type { Shape } from "@/lib/marketView";

/** Слои под точками. Толщина линий — экранная (non-scaling-stroke), как в эталоне. */
export function MapBaseLayers({ shape }: { shape: Shape }) {
  return (
    <g>
      {shape.land && (
        <path d={shape.land} fill="var(--land2)" stroke="var(--land2-line)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      )}
      <path d={shape.path} fill="var(--land)" fillRule="evenodd" stroke="var(--border)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </g>
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

const LABEL_PX = 12, LABEL_HALO = 3, LABEL_OFF = 6;

/** Подписи городов — SVG-текст эталона: кегль 12 px экрана (делится на масштаб), обводка цвета
 *  суши под текстом. `unit` — единиц карты на экранный пиксель. */
export function CityLabels({ shape, unit }: { shape: Shape; unit: number }) {
  return (
    <g pointerEvents="none">
      {(shape.cities ?? []).map((c) => (
        <text
          key={c.name}
          x={c.x}
          y={c.y}
          dx={LABEL_OFF * unit}
          dy={-LABEL_OFF * unit}
          fontSize={LABEL_PX * unit}
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={600}
          fill="var(--ink2)"
          stroke="var(--land)"
          strokeWidth={LABEL_HALO * unit}
          paintOrder="stroke"
        >
          {c.name}
        </text>
      ))}
    </g>
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
