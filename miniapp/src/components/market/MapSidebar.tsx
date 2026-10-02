"use client";
// Боковая панель карты — как в референсе: вид, год с проигрыванием, год открытия, сети,
// флажки пекарен и анонсов, число точек и топ городов.
import type { MarketChain } from "@/types";
import { type CityRow, PRE } from "@/lib/marketMap";
import { useDt } from "@/components/roy/nav";
import { Chip } from "./ui";
import type { MapMode } from "./MapView";

type Props = {
  mode: MapMode;
  setMode: (m: MapMode) => void;
  year: number;
  setYear: (y: number) => void;
  firstYear: number;
  thisYear: number;
  playing: boolean;
  togglePlay: () => void;
  openFirst: number;
  openYears: ReadonlySet<string> | null;
  setOpenYears: (s: Set<string> | null) => void;
  chains: MarketChain[];
  counts: Map<string, number>;
  colors: Map<string, string>;
  hidden: ReadonlySet<string>;
  setHidden: (s: Set<string>) => void;
  bakeries: boolean;
  setBakeries: (v: boolean) => void;
  hasBakeries: boolean;
  planned: boolean;
  setPlanned: (v: boolean) => void;
  hasPlanned: boolean;
  total: number;
  cities: CityRow[];
};

const label = "mb-1.5 block font-semibold uppercase tracking-wide text-ink-mute";

export function MapSidebar(p: Props) {
  const dt = useDt();
  const buckets = [PRE, ...Array.from({ length: p.thisYear - p.openFirst + 1 }, (_, i) => String(p.openFirst + i))];
  // Клик по году при «всех» оставляет только его; дальше — переключение; пусто → снова все.
  const pickYear = (b: string) => {
    const cur = p.openYears ?? new Set<string>();
    const next = p.openYears ? new Set(cur) : new Set<string>();
    if (p.openYears && cur.has(b)) next.delete(b);
    else next.add(b);
    p.setOpenYears(next.size && next.size < buckets.length ? next : null);
  };
  const toggleChain = (k: string) => {
    const n = new Set(p.hidden);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    p.setHidden(n);
  };
  const visibleChains = p.chains.filter((c) => p.bakeries || !c.is_bakery);
  const cityMax = Math.max(1, ...p.cities.map((c) => c.total));

  return (
    <aside className="flex flex-col gap-4" style={{ fontSize: 13 }}>
      <div>
        <span className={label} style={{ fontSize: 11 }}>{dt("Вид", "View")}</span>
        <div className="flex flex-wrap gap-1.5">
          {([["heat", "Хитмап", "Heatmap"], ["dots", "Точки", "Dots"], ["both", "Оба", "Both"]] as const).map(([m, ru, en]) => (
            <Chip key={m} active={p.mode === m} onClick={() => p.setMode(m)}>{dt(ru, en)}</Chip>
          ))}
        </div>
      </div>

      <div>
        <span className={label} style={{ fontSize: 11 }}>
          {dt("На конец года", "At year end")} <b className="text-ink">{p.year}</b>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={p.togglePlay}
            aria-label={p.playing ? dt("Пауза", "Pause") : dt("Проиграть по годам", "Play through years")}
            className="size-8 shrink-0 rounded-md border border-line bg-card text-ink hover:bg-accent-soft"
          >
            {p.playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={p.firstYear}
            max={p.thisYear}
            value={p.year}
            onChange={(e) => p.setYear(Number(e.target.value))}
            className="w-full accent-[var(--accent-ink)]"
            aria-label={dt("Год", "Year")}
          />
        </div>
      </div>

      <div>
        <span className={label} style={{ fontSize: 11 }}>{dt("Год открытия", "Opening year")}</span>
        <div className="flex flex-wrap gap-1.5">
          {buckets.map((b) => (
            <Chip key={b} active={!p.openYears || p.openYears.has(b)} onClick={() => pickYear(b)}>
              {b === PRE ? dt(`до ${p.openFirst} / н.д.`, `before ${p.openFirst} / n/a`) : b}
            </Chip>
          ))}
          <Chip active={!p.openYears} onClick={() => p.setOpenYears(null)}>{dt("Все годы", "All years")}</Chip>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className={label} style={{ fontSize: 11, marginBottom: 0 }}>{dt("Сети", "Chains")}</span>
          <span className="flex gap-2 text-accent-ink" style={{ fontSize: 12 }}>
            <button type="button" onClick={() => p.setHidden(new Set())}>{dt("Все", "All")}</button>
            <button type="button" onClick={() => p.setHidden(new Set(p.chains.map((c) => c.key)))}>{dt("Сбросить", "Clear")}</button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {visibleChains.map((c) => (
            <Chip key={c.key} active={!p.hidden.has(c.key)} onClick={() => toggleChain(c.key)} color={p.colors.get(c.key)}>
              {c.name} <span className="text-ink-mute">{p.counts.get(c.key) ?? 0}</span>
            </Chip>
          ))}
        </div>
      </div>

      {(p.hasBakeries || p.hasPlanned) && (
        <div className="flex flex-col gap-1.5 text-ink-soft">
          {p.hasBakeries && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.bakeries} onChange={(e) => p.setBakeries(e.target.checked)} className="accent-[var(--accent-ink)]" />
              {dt("Пекарни и кафе", "Bakeries and cafés")}
            </label>
          )}
          {p.hasPlanned && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.planned} onChange={(e) => p.setPlanned(e.target.checked)} className="accent-[var(--accent-ink)]" />
              {dt("Показать анонсированные", "Show announced")}
            </label>
          )}
        </div>
      )}

      <div className="rounded-lg border border-line p-3">
        <div className="text-ink-mute" style={{ fontSize: 11 }}>{dt("Точек на карте", "Locations on the map")}</div>
        <div className="font-semibold text-ink tabular-nums" style={{ fontSize: 24 }}>{p.total}</div>
      </div>

      {p.cities.length > 0 && (
        <div>
          <span className={label} style={{ fontSize: 11 }}>{dt("Топ городов", "Top cities")}</span>
          <ul className="flex flex-col gap-1.5">
            {p.cities.map((c) => (
              <li key={c.city}>
                <div className="flex justify-between text-ink-soft" style={{ fontSize: 12 }}>
                  <span className="truncate">{c.city}</span>
                  <span className="tabular-nums text-ink">{c.total}</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" style={{ width: `${(c.total / cityMax) * 100}%` }}>
                  {c.byChain.map(([k, n]) => (
                    <span key={k} style={{ width: `${(n / c.total) * 100}%`, background: p.colors.get(k) }} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
