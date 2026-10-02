"use client";
// Карта точек страны по образцу хорватского референса (решение владельца 02.10.2026,
// docs/decisions/2026-10-02-market-follow-reference-visual.md): хитмап по умолчанию, точки
// и оба слоя; зум и сдвиг; пресеты «Вся страна» и крупные города; год с проигрыванием;
// фильтры года открытия, сетей, пекарен и анонсов; справа — число точек и топ городов.
import { useEffect, useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { chainColors, topCities, visibleLocations } from "@/lib/marketMap";
import { project, type Shape } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { clampVb, type MapMode, MapView } from "./MapView";
import { MapSidebar } from "./MapSidebar";
import type { ViewBox } from "./heat";
import { Chip, Empty, Section, SourceCaption } from "./ui";

const PLAY_MS = 900;
const OPEN_YEARS = 5; // фильтр «Год открытия»: последние пять лет поштучно, раньше — одной корзиной
const PRESET_CITIES = 4;
const PRESET_SPAN = 0.25; // ширина кадра города — четверть страны

export function MarketMap({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const thisYear = new Date().getFullYear();
  const openFirst = thisYear - OPEN_YEARS;
  const [shape, setShape] = useState<Shape | null>(null);
  const [shapeFailed, setShapeFailed] = useState(false);
  const [mode, setMode] = useState<MapMode>("heat");
  const [year, setYear] = useState(thisYear);
  const [playing, setPlaying] = useState(false);
  const [openYears, setOpenYears] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [bakeries, setBakeries] = useState(false);
  const [planned, setPlanned] = useState(true);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 1, h: 1 });
  const [preset, setPreset] = useState<string | null>(null);

  useEffect(() => {
    setShape(null);
    setShapeFailed(false);
    fetch(`/market/shapes/${bundle.country}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s: Shape) => {
        setShape(s);
        setVb({ x: 0, y: 0, w: s.W, h: s.H });
        setPreset(null);
      })
      .catch((e) => {
        console.error("[MarketMap] shape", e);
        setShapeFailed(true);
      });
  }, [bundle.country]);

  const firstYear = useMemo(() => {
    const ys = bundle.locations.map((l) => Number(l.opened?.slice(0, 4))).filter((y) => y > 1990);
    return ys.length ? Math.max(Math.min(...ys), thisYear - 25) : thisYear - 5;
  }, [bundle.locations, thisYear]);

  // Проигрывание: шаг в год, с конца — с начала; на текущем годе останавливается.
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      if (year >= thisYear) setPlaying(false);
      else setYear(year + 1);
    }, PLAY_MS);
    return () => clearTimeout(id);
  }, [playing, year, thisYear]);
  const togglePlay = () => {
    if (!playing && year >= thisYear) setYear(firstYear);
    setPlaying(!playing);
  };

  const bakery = useMemo(() => new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key)), [bundle.chains]);
  const colors = useMemo(() => chainColors(bundle.chains, bundle.locations), [bundle.chains, bundle.locations]);
  const chainName = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const visible = useMemo(
    () => visibleLocations(bundle.locations, bakery, { year, thisYear, hidden, bakeries, planned, openYears, firstYear: openFirst }),
    [bundle.locations, bakery, year, thisYear, hidden, bakeries, planned, openYears, openFirst],
  );
  // Счётчики сетей — без учёта выключенных сетей, иначе выключенная показывала бы ноль.
  const counts = useMemo(() => {
    const all = visibleLocations(bundle.locations, bakery, { year, thisYear, hidden: new Set(), bakeries: true, planned, openYears, firstYear: openFirst });
    const c = new Map<string, number>();
    for (const l of all) c.set(l.chain_key, (c.get(l.chain_key) ?? 0) + 1);
    return c;
  }, [bundle.locations, bakery, year, thisYear, planned, openYears, openFirst]);
  const chains = useMemo(() => [...bundle.chains].sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0)), [bundle.chains, counts]);

  // Пресеты: крупнейшие города по числу точек, центр кадра — средняя их точек.
  const presets = useMemo(() => {
    if (!shape) return [];
    return topCities(bundle.locations.filter((l) => l.status !== "closed"), PRESET_CITIES).map(({ city }) => {
      const ps = bundle.locations.filter((l) => l.city === city).map((l) => project(shape.proj, l.lat, l.lng));
      const cx = ps.reduce((s, p) => s + p[0], 0) / ps.length, cy = ps.reduce((s, p) => s + p[1], 0) / ps.length;
      const w = shape.W * PRESET_SPAN, h = (w * shape.H) / shape.W;
      return { city, vb: clampVb({ x: cx - w / 2, y: cy - h / 2, w, h }, shape) };
    });
  }, [shape, bundle.locations]);

  if (!bundle.locations.length) {
    return (
      <Section title={dt("Карта точек", "Locations map")}>
        <Empty text={dt("Точек пока нет: сборщик ещё не запускался.", "No locations yet: the collector has not run.")} />
        <SourceCaption bundle={bundle} feeds="locations" />
      </Section>
    );
  }

  const go = (name: string | null, v: ViewBox) => {
    setPreset(name);
    setVb(v);
  };
  const userVb = (f: (v: ViewBox) => ViewBox) => {
    setPreset(null);
    setVb(f);
  };

  return (
    <Section title={dt("Карта точек", "Locations map")}>
      {shape && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Chip active={preset === null && vb.w >= shape.W} onClick={() => go(null, { x: 0, y: 0, w: shape.W, h: shape.H })}>
            {dt("Вся страна", "Whole country")}
          </Chip>
          {presets.map((p) => (
            <Chip key={p.city} active={preset === p.city} onClick={() => go(p.city, p.vb)}>{p.city}</Chip>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {shapeFailed && <Empty text={dt("Контур страны не загрузился.", "Country outline failed to load.")} />}
          {shape && (
            <MapView
              shape={shape}
              locs={visible}
              colors={colors}
              chainName={chainName}
              bakery={bakery}
              mode={mode}
              vb={vb}
              setVb={userVb}
              country={bundle.country}
            />
          )}
          <p className="mt-2 text-ink-mute" style={{ fontSize: 12 }}>
            {mode === "dots"
              ? dt(
                "Цвет — сеть. Полый кружок — дата открытия оценена, пунктир — анонс, бледная — на паузе.",
                "Colour is the chain. Hollow dot — opening date estimated, dashed — announced, faded — paused.",
              )
              : dt(
                "Чем темнее, тем больше точек рядом. Колесо или +/− — масштаб, перетаскивание — сдвиг.",
                "Darker means more locations nearby. Wheel or +/− to zoom, drag to pan.",
              )}
          </p>
        </div>
        <MapSidebar
          mode={mode}
          setMode={setMode}
          year={year}
          setYear={(y) => {
            setPlaying(false);
            setYear(y);
          }}
          firstYear={firstYear}
          thisYear={thisYear}
          playing={playing}
          togglePlay={togglePlay}
          openFirst={openFirst}
          openYears={openYears}
          setOpenYears={setOpenYears}
          chains={chains}
          counts={counts}
          colors={colors}
          hidden={hidden}
          setHidden={setHidden}
          bakeries={bakeries}
          setBakeries={setBakeries}
          hasBakeries={bakery.size > 0}
          planned={planned}
          setPlanned={setPlanned}
          hasPlanned={bundle.locations.some((l) => l.status === "planned")}
          total={visible.length}
          cities={topCities(visible)}
        />
      </div>
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}
