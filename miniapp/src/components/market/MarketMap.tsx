"use client";
// Блок «Карта — Где стоят рестораны» эталона (#map-sec, решение владельца 02.10.2026,
// docs/decisions/2026-10-02-market-follow-reference-visual.md): хитмап по умолчанию, точки и оба
// слоя; зум и сдвиг; пресеты кадра (ручная часть, без неё — крупнейшие города); состояние сети
// на конец года с проигрыванием; фильтры года открытия, сетей, пекарен и анонсов; справа —
// число точек и топ городов.
import { useEffect, useMemo, useState } from "react";
import type { MarketBundle } from "@/types";
import { chainCounts, fitBox, makeVb, PRE, pickOpenYear, topCities, type ViewBox, visibleLocations } from "@/lib/marketMap";
import { project } from "@/lib/marketView";
import { useDt } from "@/components/roy/nav";
import { type MapMode, MapView } from "./MapView";
import { useShape } from "./MapBase";
import { MapSidebar } from "./MapSidebar";
import { RefSection, useChainColor, useChainOrder, useEditorial } from "./ref";
import { Empty, SourceCaption } from "./ui";

const PLAY_MS = 900;
const PLAY_FROM = 2020; // проигрывание и ползунок — с 2020, как в эталоне
const OPEN_FIRST = 2021; // фильтр «Год открытия»: поштучно с 2021, раньше и без даты — одной корзиной
const PRESET_CITIES = 4;
const PRESET_SPAN = 0.25; // без ручной части: кадр города — четверть страны
const CITY_LIMIT = 10;

export function MarketMap({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ed = useEditorial(bundle);
  const col = useChainColor(bundle);
  const order = useChainOrder(bundle);
  const thisYear = new Date().getFullYear();
  const { shape, failed: shapeFailed } = useShape(bundle.country);
  const [mode, setMode] = useState<MapMode>("heat");
  const [year, setYear] = useState(thisYear);
  const [playing, setPlaying] = useState(false);
  const [openYears, setOpenYears] = useState<Set<string> | null>(null);
  // Включённые сети; пока не трогали (или сменилась страна) — все, кроме пекарен.
  const [onState, setOnState] = useState<{ country: string; on: Set<string> } | null>(null);
  const [bakeries, setBakeries] = useState(false);
  const [planned, setPlanned] = useState(true);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 1, h: 1 });

  // Новая подложка — вид на всю страну.
  useEffect(() => {
    if (shape) setVb({ x: 0, y: 0, w: shape.W, h: shape.H });
  }, [shape]);

  // Проигрывание: с PLAY_FROM шаг в год; после текущего года останавливается.
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      if (year >= thisYear) setPlaying(false);
      else setYear(year + 1);
    }, PLAY_MS);
    return () => clearTimeout(id);
  }, [playing, year, thisYear]);
  const togglePlay = () => {
    if (!playing) setYear(PLAY_FROM);
    setPlaying(!playing);
  };

  const bakery = useMemo(() => new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key)), [bundle.chains]);
  const on = useMemo(
    () => (onState?.country === bundle.country ? onState.on : new Set(bundle.chains.filter((c) => !c.is_bakery).map((c) => c.key))),
    [onState, bundle.country, bundle.chains],
  );
  const setOn = (s: Set<string>) => setOnState({ country: bundle.country, on: s });
  const chainName = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.name])), [bundle.chains]);
  const slot = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.slot || 99])), [bundle.chains]);
  const buckets = useMemo(() => [PRE, ...Array.from({ length: Math.max(0, thisYear - OPEN_FIRST + 1) }, (_, i) => String(OPEN_FIRST + i))], [thisYear]);
  const visible = useMemo(() => {
    const hidden = new Set(bundle.chains.filter((c) => !on.has(c.key)).map((c) => c.key));
    return visibleLocations(bundle.locations, bakery, { year, thisYear, hidden, bakeries, planned, openYears, firstYear: OPEN_FIRST });
  }, [bundle.locations, bundle.chains, bakery, on, year, thisYear, bakeries, planned, openYears]);
  const counts = useMemo(() => chainCounts(bundle.locations), [bundle.locations]);

  // Пресеты: ручная часть (box = [lng0, lat0, lng1, lat1], вписать как fitBox эталона), без неё —
  // крупнейшие города по числу точек, центр кадра — средняя их точек.
  const presets = useMemo(() => {
    if (!shape) return [];
    if (ed.mapPresets.length) {
      return ed.mapPresets.map(({ name, box: [lng0, lat0, lng1, lat1] }) => {
        const a = project(shape.proj, lat0, lng0), c = project(shape.proj, lat1, lng1);
        return { name, vb: fitBox(a[0], a[1], c[0], c[1], shape.W, shape.H) };
      });
    }
    return topCities(bundle.locations.filter((l) => l.status !== "closed"), PRESET_CITIES).map(({ city }) => {
      const ps = bundle.locations.filter((l) => l.city === city).map((l) => project(shape.proj, l.lat, l.lng));
      const cx = ps.reduce((s, p) => s + p[0], 0) / ps.length, cy = ps.reduce((s, p) => s + p[1], 0) / ps.length;
      const w = shape.W * PRESET_SPAN, h = (w * shape.H) / shape.W;
      return { name: city, vb: makeVb(cx - w / 2, cy - h / 2, w, shape.W, shape.H) };
    });
  }, [shape, ed.mapPresets, bundle.locations]);

  const lede = ed.texts.map ?? dt(
    "Хитмап показывает плотность точек; переключитесь на «Точки», чтобы увидеть каждую. Фильтр «Год открытия» оставляет точки, открытые в выбранные годы; ползунок показывает, какой была сеть на конец года. Колесо или кнопки +/− для зума, перетаскивание для сдвига.",
    "The heatmap shows location density; switch to “Dots” to see each one. The “Opening year” filter keeps locations opened in the selected years; the slider shows the network as it stood at year end. Wheel or +/− to zoom, drag to pan.",
  );
  const feeds = ed.mapPresets.length || ed.texts.map ? ["locations" as const, "editorial" as const] : "locations" as const;
  const head = { id: "map-sec", eyebrow: dt("Карта", "Map"), title: dt("Где стоят рестораны", "Where the restaurants are"), lede };

  if (!bundle.locations.length) {
    return (
      <RefSection {...head}>
        <Empty text={dt("Точек пока нет: сборщик ещё не запускался.", "No locations yet: the collector has not run.")} />
        <SourceCaption bundle={bundle} feeds="locations" />
      </RefSection>
    );
  }

  const toggleChain = (k: string) => {
    const n = new Set(on);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOn(n);
  };
  const setBakeriesOn = (v: boolean) => {
    setBakeries(v);
    const n = new Set(on);
    for (const k of bakery) {
      if (v) n.add(k);
      else n.delete(k);
    }
    setOn(n);
  };

  return (
    <RefSection {...head}>
      <div className="mapgrid">
        <div className="mapcol">
          {shape && (
            <div className="maptools">
              <button type="button" onClick={() => setVb({ x: 0, y: 0, w: shape.W, h: shape.H })}>{dt("Вся страна", "Whole country")}</button>
              {presets.map((p) => <button key={p.name} type="button" onClick={() => setVb(p.vb)}>{p.name}</button>)}
            </div>
          )}
          {shapeFailed && <Empty text={dt("Контур страны не загрузился.", "Country outline failed to load.")} />}
          {shape && <MapView shape={shape} locs={visible} col={col} chainName={chainName} bakery={bakery} mode={mode} vb={vb} setVb={setVb} />}
        </div>
        <MapSidebar
          bakeryLabel={ed.texts.bakery_names ?? null}
          mode={mode}
          setMode={setMode}
          year={year}
          setYear={(y) => {
            setPlaying(false);
            setYear(y);
          }}
          playFrom={PLAY_FROM}
          thisYear={thisYear}
          playing={playing}
          togglePlay={togglePlay}
          openFirst={OPEN_FIRST}
          buckets={buckets}
          openYears={openYears}
          pickOpenYear={(b) => setOpenYears(pickOpenYear(openYears, b, buckets))}
          allOpenYears={() => setOpenYears(null)}
          chains={order}
          counts={counts}
          col={col}
          on={on}
          toggleChain={toggleChain}
          allOn={() => setOn(new Set([...on, ...bundle.chains.filter((c) => !c.is_bakery || bakeries).map((c) => c.key)]))}
          allOff={() => setOn(new Set())}
          bakeries={bakeries}
          setBakeries={setBakeriesOn}
          planned={planned}
          setPlanned={setPlanned}
          hasPlanned={bundle.locations.some((l) => l.status === "planned")}
          total={visible.length}
          cities={topCities(visible, CITY_LIMIT, (k) => slot.get(k) ?? 99)}
          chainName={chainName}
        />
      </div>
      <SourceCaption bundle={bundle} feeds={feeds} />
    </RefSection>
  );
}
