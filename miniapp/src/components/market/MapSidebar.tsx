"use client";
// Боковая панель карты — .panel.side эталона: вид, состояние сети на конец года с
// проигрыванием, год открытия, сети, флажки пекарен и анонсов, число точек и топ городов.
import type { MarketChain } from "@/types";
import { type CityRow, PRE } from "@/lib/marketMap";
import { useDt } from "@/components/roy/nav";
import { Sw } from "./ref";
import type { MapMode } from "./MapView";

type Props = {
  mode: MapMode;
  setMode: (m: MapMode) => void;
  year: number;
  setYear: (y: number) => void;
  playFrom: number;
  thisYear: number;
  playing: boolean;
  togglePlay: () => void;
  openFirst: number;
  buckets: readonly string[];
  openYears: ReadonlySet<string> | null;
  pickOpenYear: (b: string) => void;
  allOpenYears: () => void;
  chains: MarketChain[]; // в порядке эталона: не пекарни, слот, имя
  counts: Map<string, number>;
  col: (key: string) => string;
  on: ReadonlySet<string>;
  toggleChain: (k: string) => void;
  allOn: () => void;
  allOff: () => void;
  bakeries: boolean;
  setBakeries: (v: boolean) => void;
  planned: boolean;
  setPlanned: (v: boolean) => void;
  hasPlanned: boolean;
  total: number;
  cities: CityRow[];
  chainName: Map<string, string>;
  bakeryLabel: string | null; // texts.bakery_names ручной части, иначе — имена сетей-пекарен
};

const MODES = [["heat", "Хитмап", "Heatmap"], ["dots", "Точки", "Dots"], ["both", "Оба", "Both"]] as const;

export function MapSidebar(p: Props) {
  const dt = useDt();
  const bakeryNames = p.chains.filter((c) => c.is_bakery).map((c) => c.name);
  const bakeryLabel = p.bakeryLabel ?? bakeryNames.join(", ");
  const cityMax = p.cities.length ? p.cities[0].total : 1;

  return (
    <div className="panel side">
      <div className="ctl">
        <span className="lbl">{dt("Вид", "View")}</span>
        <div className="seg">
          {MODES.map(([m, ru, en]) => (
            <button key={m} type="button" aria-pressed={p.mode === m} onClick={() => p.setMode(m)}>{dt(ru, en)}</button>
          ))}
        </div>
      </div>

      <div className="ctl">
        <label htmlFor="mkt-map-yr">{dt("Состояние сети на конец года", "Network at year end")}</label>
        <div className="yearrow">
          <button type="button" onClick={p.togglePlay} aria-label={dt(`Проиграть ${p.playFrom}–${p.thisYear}`, `Play ${p.playFrom}–${p.thisYear}`)}>
            {p.playing ? "■" : "▶"}
          </button>
          <input type="range" id="mkt-map-yr" min={p.playFrom} max={p.thisYear} step={1} value={p.year} onChange={(e) => p.setYear(Number(e.target.value))} />
          <output htmlFor="mkt-map-yr">{p.year}</output>
        </div>
      </div>

      <div className="ctl">
        <span className="lbl">{dt("Год открытия", "Opening year")}</span>
        <div className="seg">
          {p.buckets.map((b) => (
            <button key={b} type="button" aria-pressed={!!p.openYears?.has(b)} onClick={() => p.pickOpenYear(b)}>
              {b === PRE ? dt(`до ${p.openFirst} / н.д.`, `before ${p.openFirst} / n/a`) : b}
            </button>
          ))}
          <button type="button" aria-pressed={!p.openYears} onClick={p.allOpenYears}>{dt("Все годы", "All years")}</button>
        </div>
      </div>

      <div className="ctl">
        <span className="lbl">{dt("Сети", "Chains")}</span>
        <div className="chips">
          {p.chains.map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed={p.on.has(c.key)} onClick={() => p.toggleChain(c.key)}>
              <Sw color={p.col(c.key)} />
              {c.name} <span className="ct">{p.counts.get(c.key) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="seg">
          <button type="button" onClick={p.allOn}>{dt("Все", "All")}</button>
          <button type="button" onClick={p.allOff}>{dt("Сбросить", "Clear")}</button>
        </div>
      </div>

      {(bakeryNames.length > 0 || p.hasPlanned) && (
        <div className="ctl">
          {bakeryNames.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={p.bakeries} onChange={(e) => p.setBakeries(e.target.checked)} />
              {dt("Пекарни и кафе", "Bakeries and cafés")} ({bakeryLabel})
            </label>
          )}
          {p.hasPlanned && (
            <label className="check">
              <input type="checkbox" checked={p.planned} onChange={(e) => p.setPlanned(e.target.checked)} />
              {dt("Показать анонсированные", "Show announced")}
            </label>
          )}
        </div>
      )}

      <div className="stat">
        <span className="muted">{dt("Точек на карте", "Locations on the map")}</span>
        <b>{p.total}</b>
      </div>

      <div className="ctl">
        <span className="lbl">{dt("Топ городов", "Top cities")}</span>
        <div className="citybars">
          {p.cities.length
            ? p.cities.map((c) => (
              <div key={c.city} className="cb">
                <span className="c">{c.city}</span>
                <span className="bar">
                  {c.byChain.map(([k, v]) => (
                    <i key={k} style={{ width: `${(v / cityMax) * 100}%`, background: p.col(k) }} title={`${p.chainName.get(k) ?? k}: ${v}`} />
                  ))}
                </span>
                <span className="n">{c.total}</span>
              </div>
            ))
            : <span className="muted">{dt("Нет точек при текущих фильтрах", "No locations with the current filters")}</span>}
        </div>
      </div>
    </div>
  );
}
