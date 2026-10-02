"use client";
// Карта точек страны: контур (public/market/shapes/<CC>.json) + точки сетей на конец
// выбранного года. Режим «Плотность» — сетка 20×20, где больше точек, там темнее.
import { useEffect, useMemo, useState } from "react";
import type { MarketBundle, MarketLocation } from "@/types";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { densityGrid, project, segmentColor, type Shape } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { CityLabels, MapBaseLayers, useElementWidth } from "./MapBase";
import { Chip, Empty, Section, SourceCaption } from "./ui";

const GRID = 20;
const VERIF: Record<string, [string, string]> = {
  official: ["официально", "official"],
  confirmed: ["проверено", "confirmed"],
  corrected: ["исправлено", "corrected"],
  added: ["добавлено вручную", "added manually"],
  unverified: ["не проверено", "unverified"],
  internal: ["данные Dodo", "Dodo data"],
};

export function MarketMap({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const [shape, setShape] = useState<Shape | null>(null);
  const [shapeFailed, setShapeFailed] = useState(false);
  const [mode, setMode] = useState<"points" | "density">("points");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [hover, setHover] = useState<MarketLocation | null>(null);
  const [mapRef, mapWidth] = useElementWidth<HTMLDivElement>();

  useEffect(() => {
    setShape(null);
    setShapeFailed(false);
    fetch(`/market/shapes/${bundle.country}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setShape)
      .catch((e) => {
        console.error("[MarketMap] shape", e);
        setShapeFailed(true);
      });
  }, [bundle.country]);

  const chainByKey = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c])), [bundle.chains]);
  const firstYear = useMemo(() => {
    const ys = bundle.locations.map((l) => Number(l.opened?.slice(0, 4))).filter((y) => y > 1990);
    return ys.length ? Math.max(Math.min(...ys), thisYear - 25) : thisYear - 5;
  }, [bundle.locations, thisYear]);

  const visible = useMemo(
    () =>
      bundle.locations.filter((l) => !hidden.has(l.chain_key) && aliveAtYearEnd([l], year) === 1),
    [bundle.locations, hidden, year],
  );
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of bundle.locations) if (aliveAtYearEnd([l], year)) c.set(l.chain_key, (c.get(l.chain_key) ?? 0) + 1);
    return c;
  }, [bundle.locations, year]);

  if (!bundle.locations.length) {
    return (
      <Section title={dt("Карта точек", "Locations map")}>
        <Empty text={dt("Точек пока нет: сборщик ещё не запускался.", "No locations yet: the collector has not run.")} />
        <SourceCaption bundle={bundle} feeds="locations" />
      </Section>
    );
  }

  const toggle = (key: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  // Точки — в экранных пикселях: до первого замера ширины считаем карту в натуральную величину.
  const dot = shape && mapWidth ? shape.W / mapWidth : 1;
  const pts = shape ? visible.map((l) => [l, project(shape.proj, l.lat, l.lng)] as const) : [];
  const grid = shape && mode === "density" ? densityGrid(pts.map(([, p]) => p), shape.W, shape.H, GRID) : null;
  const gridMax = grid ? Math.max(1, ...grid.flat()) : 1;
  const sorted = [...bundle.chains].sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));

  return (
    <Section
      title={dt("Карта точек", "Locations map")}
      aside={
        <div className="flex gap-1.5">
          <Chip active={mode === "points"} onClick={() => setMode("points")}>{dt("Точки", "Points")}</Chip>
          <Chip active={mode === "density"} onClick={() => setMode("density")}>{dt("Плотность", "Density")}</Chip>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {sorted.map((c) => (
          <Chip key={c.key} active={!hidden.has(c.key)} onClick={() => toggle(c.key)} color={segmentColor(c.segment)}>
            {c.name} <span className="text-ink-mute">{counts.get(c.key) ?? 0}</span>
          </Chip>
        ))}
      </div>
      <label className="mb-3 flex items-center gap-3 text-ink-soft" style={{ fontSize: 13 }}>
        <span className="shrink-0">{dt("На конец года", "At year end")} <b className="text-ink">{year}</b></span>
        <input
          type="range"
          min={firstYear}
          max={thisYear}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
          aria-label={dt("Год", "Year")}
        />
      </label>
      <div className="relative" ref={mapRef}>
        {shapeFailed && <Empty text={dt("Контур страны не загрузился.", "Country outline failed to load.")} />}
        {shape && (
          <svg viewBox={`0 0 ${shape.W} ${shape.H}`} className="block h-auto w-full overflow-hidden rounded-lg" role="img" aria-label={dt("Карта точек", "Locations map")}>
            <MapBaseLayers shape={shape} clipId={`mkt-clip-${bundle.country}`} unit={dot} />
            {grid &&
              grid.flatMap((row, i) =>
                row.map((n, j) =>
                  n
                    ? (
                      <rect
                        key={`${i}:${j}`}
                        x={(j * shape.W) / GRID}
                        y={(i * shape.H) / GRID}
                        width={shape.W / GRID}
                        height={shape.H / GRID}
                        fill="var(--chart-1)"
                        opacity={0.12 + 0.75 * (n / gridMax)}
                        clipPath={`url(#mkt-clip-${bundle.country})`}
                      >
                        <title>{n}</title>
                      </rect>
                    )
                    : null
                )
              )}
            {!grid &&
              pts.map(([l, [x, y]]) => {
                const ch = chainByKey.get(l.chain_key);
                const color = segmentColor(ch?.segment ?? "other");
                const dodo = l.chain_key === "dodo";
                return (
                  <circle
                    key={l.id}
                    cx={x}
                    cy={y}
                    r={(dodo ? 5 : 3.6) * dot}
                    fill={l.opened_estimated ? "var(--map-country)" : color}
                    // Светлая обводка разделяет точки в плотном центре города, иначе они
                    // сливаются в одно пятно; у полой (дата оценена) обводка — цвет сети.
                    stroke={dodo ? "var(--ink)" : l.opened_estimated ? color : "var(--map-country)"}
                    strokeWidth={(dodo ? 1.5 : l.opened_estimated ? 1.2 : 0.8) * dot}
                    onMouseEnter={() => setHover(l)}
                    onMouseLeave={() => setHover((h) => (h?.id === l.id ? null : h))}
                    onClick={() => setHover(l)}
                  />
                );
              })}
          </svg>
        )}
        {shape && <CityLabels shape={shape} width={mapWidth} />}
        {hover && (
          <div className="pointer-events-none absolute left-2 top-2 max-w-[260px] rounded-lg border border-line bg-card p-2.5 shadow-sm" style={{ fontSize: 12 }}>
            <div className="font-semibold text-ink">{hover.name}</div>
            <div className="text-ink-soft">{[hover.address, hover.city].filter(Boolean).join(", ")}</div>
            <div className="text-ink-mute">
              {dt("Открыта", "Opened")} {hover.opened ?? "—"}
              {hover.opened_estimated ? dt(" (оценка)", " (estimated)") : ""}
              {hover.status === "closed" ? ` · ${dt("закрыта", "closed")} ${hover.closed ?? ""}` : ""}
            </div>
            <div className="text-ink-mute">{VERIF[hover.verification] ? dt(...VERIF[hover.verification]) : hover.verification}</div>
          </div>
        )}
      </div>
      <p className="mt-2 text-ink-mute" style={{ fontSize: 12 }}>
        {dt(
          "Цвет — сегмент сети. Dodo — с обводкой. Полый кружок — дата открытия оценена.",
          "Colour is the chain's segment. Dodo has an outline. Hollow dot — opening date estimated.",
        )}
      </p>
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}
