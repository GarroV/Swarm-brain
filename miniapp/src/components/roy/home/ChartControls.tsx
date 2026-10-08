"use client";
import { useEffect, useState } from "react";
import { useDt } from "../nav";
import { RoyIcon } from "../icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PILL_GROUP_CLS, pillSegmentCls } from "@/components/ui/PropertyPill";
import { COUNTRY_NAMES, countryFlag, countryName } from "@/lib/countries";
import {
  canShift, clampRange, monthIndex, monthShort, monthYear, rangeLabel, shiftRange,
  type Grain, type MonthKey, type MonthRange,
} from "@/lib/homeChartSeries";

// Настройки графика рейтинга (просьба владельца 08.10.2026): какие страны рисовать и за какой
// период с какой разбивкой. Оба меню — у самого графика: период и разбивка этого блока свои,
// и подписаны на нём же (правило «если у блока свой горизонт, это подписано прямо на блоке»).

/** Цвета линий стран по порядку выбора. Красный и зелёный — последними: они же «ниже нормы» и «норма». */
export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-3)", "var(--chart-5)"];
export const MAX_COUNTRIES = SERIES_COLORS.length;

export type ChartPrefs = { countries: string[]; range: MonthRange; grain: Grain };

/**
 * Настройки графика — у человека на устройстве. Читаются в эффекте (на сервере localStorage нет),
 * доступ в try/catch: в приватном окне хранилище кидает, график тогда живёт до перезагрузки.
 */
export function useChartPrefs(id: string, defaults: ChartPrefs, bounds: MonthRange, grains: Grain[]) {
  const key = `roy_home_chart_${id}_v1`;
  const [prefs, setPrefs] = useState<ChartPrefs>(defaults);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<ChartPrefs> | null;
      if (!raw) return;
      setPrefs({
        countries: Array.isArray(raw.countries) ? raw.countries.filter((c) => c in COUNTRY_NAMES).slice(0, MAX_COUNTRIES) : defaults.countries,
        range: raw.range && Number.isFinite(raw.range.from) && Number.isFinite(raw.range.to) ? clampRange(raw.range, bounds) : defaults.range,
        grain: raw.grain && grains.includes(raw.grain) ? raw.grain : defaults.grain,
      });
    } catch { /* нет хранилища — остаёмся на умолчаниях */ }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (patch: Partial<ChartPrefs>) => setPrefs((prev) => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* не запомнили — график уже перерисован */ }
    return next;
  });
  return [prefs, update] as const;
}

const chip = "inline-flex h-7 items-center gap-1.5 rounded-full border border-line-2 bg-surface px-2.5 font-semibold text-ink-soft transition-colors hover:border-accent-line hover:text-ink data-[popup-open]:border-accent-line data-[popup-open]:bg-accent-soft data-[popup-open]:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const menuHead = "px-1 pb-1.5 font-mono uppercase tracking-[0.08em] text-ink-mute";

export function CountryMenu({ value, onChange, mine }: { value: string[]; onChange: (next: string[]) => void; mine: string[] }) {
  const dt = useDt();
  const all = Object.keys(COUNTRY_NAMES);
  const ordered = [...mine.filter((c) => all.includes(c)), ...all.filter((c) => !mine.includes(c))];
  const full = value.length >= MAX_COUNTRIES;
  const toggle = (cc: string) => onChange(value.includes(cc) ? value.filter((c) => c !== cc) : full ? value : [...value, cc]);

  return (
    <Popover>
      <PopoverTrigger type="button" className={chip} style={{ fontSize: 12 }}
        title={dt("Какие страны на графике", "Countries on the chart")}>
        {value.length ? (
          <span className="inline-flex items-center gap-1">
            <span className="tracking-[0.12em]" style={{ fontSize: 13 }}>{value.map((cc) => countryFlag(cc)).join("")}</span>
            <span>{value.length === 1 ? dt(countryName(value[0]), value[0]) : dt(`${value.length} страны`, `${value.length} countries`)}</span>
          </span>
        ) : (
          <span>{dt("Мои страны", "My countries")}</span>
        )}
        <RoyIcon name="cright" size={11} style={{ transform: "rotate(90deg)" }} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[268px] p-1.5">
        <div className={menuHead} style={{ fontSize: 10.5 }}>{dt("Страны на графике", "Countries on the chart")}</div>
        <button type="button" onClick={() => onChange([])} aria-pressed={!value.length}
          className={`flex w-full items-start gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors ${value.length ? "hover:bg-surface-2" : "bg-accent-soft"}`}>
          <i className="mt-1.5 inline-block h-0.5 w-3.5 shrink-0 bg-primary" />
          <span className="min-w-0">
            <span className={`block font-semibold ${value.length ? "text-ink" : "text-accent-ink"}`} style={{ fontSize: 12.5 }}>{dt("Мои страны — одной линией", "My countries — one line")}</span>
            <span className="block truncate text-ink-mute" style={{ fontSize: 11 }}>
              {mine.length ? mine.map((cc) => countryFlag(cc)).join(" ") : dt("подборка пуста", "no countries picked")}
            </span>
          </span>
        </button>
        <div className="my-1 border-t border-line" />
        <div className="flex items-baseline justify-between px-1 pb-1">
          <span className="text-ink-mute" style={{ fontSize: 11 }}>{dt("Или по странам — у каждой своя линия", "Or per country — a line each")}</span>
          <span className="font-mono text-ink-mute" style={{ fontSize: 10.5 }}>{value.length}/{MAX_COUNTRIES}</span>
        </div>
        <div className="max-h-[260px] overflow-y-auto pr-0.5">
          {ordered.map((cc) => {
            const at = value.indexOf(cc);
            const on = at >= 0;
            const blocked = !on && full;
            return (
              <button key={cc} type="button" onClick={() => toggle(cc)} disabled={blocked} aria-pressed={on}
                title={blocked ? dt(`Не больше ${MAX_COUNTRIES} линий — иначе график не прочитать`, `Up to ${MAX_COUNTRIES} lines keeps the chart readable`) : undefined}
                className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors enabled:hover:bg-surface-2 disabled:opacity-40">
                <span className={`grid size-4 shrink-0 place-items-center rounded-[5px] border ${on ? "border-transparent" : "border-line-2"}`}
                  style={on ? { background: SERIES_COLORS[at] } : undefined}>
                  {on && <RoyIcon name="check" size={10} strokeWidth={3} className="text-white" />}
                </span>
                <span style={{ fontSize: 14 }}>{countryFlag(cc)}</span>
                <span className="min-w-0 flex-1 truncate text-ink" style={{ fontSize: 12.5 }}>{dt(countryName(cc), cc)}</span>
                {mine.includes(cc) && <span className="text-ink-mute" style={{ fontSize: 10.5 }}>{dt("моя", "mine")}</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const GRAIN_LABEL: Record<Grain, [string, string, string, string]> = {
  wave: ["Волны", "Waves", "по волнам", "by wave"],
  week: ["Недели", "Weeks", "по неделям", "by week"],
  month: ["Месяцы", "Months", "по месяцам", "by month"],
  quarter: ["Кварталы", "Quarters", "по кварталам", "by quarter"],
};

export function PeriodMenu({ range, grain, grains, bounds, defaults, onChange }: {
  range: MonthRange; grain: Grain; grains: Grain[]; bounds: MonthRange; defaults: Pick<ChartPrefs, "range" | "grain">;
  onChange: (patch: Partial<ChartPrefs>) => void;
}) {
  const dt = useDt();
  const en = dt("ru", "en") === "en";
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(monthYear(range.to));
  const [anchor, setAnchor] = useState<MonthKey | null>(null);
  const [hover, setHover] = useState<MonthKey | null>(null);
  useEffect(() => { if (open) { setYear(monthYear(range.to)); setAnchor(null); setHover(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Пока стоит «якорь», подсветка показывает будущий период до курсора.
  const shown: MonthRange = anchor != null
    ? { from: Math.min(anchor, hover ?? anchor), to: Math.max(anchor, hover ?? anchor) }
    : range;
  const pick = (k: MonthKey) => {
    if (anchor == null) { setAnchor(k); return; }
    onChange({ range: clampRange({ from: anchor, to: k }, bounds) });
    setAnchor(null);
  };
  const isDefault = range.from === defaults.range.from && range.to === defaults.range.to && grain === defaults.grain;
  const arrow = "grid size-7 place-items-center rounded-full text-ink-soft transition-colors enabled:hover:bg-surface-2 enabled:hover:text-ink disabled:opacity-30";

  return (
    <span className="inline-flex items-center rounded-full border border-line-2 bg-surface" style={{ fontSize: 12 }}>
      <button type="button" className={arrow} disabled={!canShift(range, -1, bounds)} onClick={() => onChange({ range: shiftRange(range, -1, bounds) })}
        aria-label={dt("Предыдущий период", "Previous period")}><RoyIcon name="cleft" size={12} /></button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-1.5 font-semibold text-ink-soft transition-colors hover:text-ink data-[popup-open]:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          title={dt("Период и разбивка графика", "Chart period and granularity")}>
          <RoyIcon name="cal" size={12} />
          <span className="whitespace-nowrap">{rangeLabel(range, en)}</span>
          <span className="font-normal text-ink-mute">· {dt(GRAIN_LABEL[grain][2], GRAIN_LABEL[grain][3])}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[264px] p-2.5">
          <div className="flex items-center justify-between pb-2">
            <span className={menuHead} style={{ fontSize: 10.5 }}>{dt("Период", "Period")}</span>
            <span className="inline-flex items-center gap-0.5">
              <button type="button" className={arrow} disabled={year <= monthYear(bounds.from)} onClick={() => setYear(year - 1)} aria-label={dt("Предыдущий год", "Previous year")}><RoyIcon name="cleft" size={12} /></button>
              <b className="w-10 text-center font-mono text-ink" style={{ fontSize: 12.5 }}>{year}</b>
              <button type="button" className={arrow} disabled={year >= monthYear(bounds.to)} onClick={() => setYear(year + 1)} aria-label={dt("Следующий год", "Next year")}><RoyIcon name="cright" size={12} /></button>
            </span>
          </div>
          <div className="grid grid-cols-4 gap-y-1" onMouseLeave={() => setHover(null)}>
            {Array.from({ length: 12 }, (_, i) => {
              const k = year * 12 + i;
              const out = k < bounds.from || k > bounds.to;
              const inside = k >= shown.from && k <= shown.to;
              const edge = k === shown.from || k === shown.to;
              return (
                <button key={k} type="button" disabled={out} onClick={() => pick(k)} onMouseEnter={() => setHover(k)}
                  className={`h-8 font-semibold transition-colors disabled:text-ink-mute/40 ${
                    edge ? "rounded-full bg-primary text-primary-foreground"
                      : inside ? "bg-accent-soft text-accent-ink"
                        : "rounded-full text-ink enabled:hover:bg-surface-2"
                  } ${inside && !edge && monthIndex(k) % 4 === 0 ? "rounded-l-full" : ""} ${inside && !edge && monthIndex(k) % 4 === 3 ? "rounded-r-full" : ""}`}
                  style={{ fontSize: 12 }}>
                  {monthShort(k, en)}
                </button>
              );
            })}
          </div>
          <p className="px-1 pt-1.5 text-ink-mute" style={{ fontSize: 11 }}>
            {anchor != null ? dt("Теперь — последний месяц", "Now pick the last month") : dt("Два клика: первый и последний месяц", "Two clicks: first and last month")}
          </p>
          <div className="mt-2.5 border-t border-line pt-2.5">
            <div className={menuHead} style={{ fontSize: 10.5 }}>{dt("Разбивка", "Granularity")}</div>
            <span className={PILL_GROUP_CLS}>
              {grains.map((g) => (
                <button key={g} type="button" onClick={() => onChange({ grain: g })} aria-pressed={grain === g}
                  className={pillSegmentCls(grain === g)} style={{ fontSize: 12 }}>
                  {dt(GRAIN_LABEL[g][0], GRAIN_LABEL[g][1])}
                </button>
              ))}
            </span>
          </div>
          {!isDefault && (
            <button type="button" onClick={() => { onChange({ range: defaults.range, grain: defaults.grain }); setOpen(false); }}
              className="mt-2.5 w-full rounded-[8px] px-2 py-1.5 text-left text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink" style={{ fontSize: 12 }}>
              {dt("Как было по умолчанию", "Reset to default")}
            </button>
          )}
        </PopoverContent>
      </Popover>
      <button type="button" className={arrow} disabled={!canShift(range, 1, bounds)} onClick={() => onChange({ range: shiftRange(range, 1, bounds) })}
        aria-label={dt("Следующий период", "Next period")}><RoyIcon name="cright" size={12} /></button>
    </span>
  );
}
