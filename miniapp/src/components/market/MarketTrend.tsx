"use client";
// Тренд запусков по образцу референса: открытий в год в раннем периоде против недавнего,
// по регионам, типу еды и формату. Только точки с известной датой; недавний период ещё
// идёт, поэтому приведён к году. Регион — укрупнённый (AREAS в build-shapes.ts); у страны
// без регионов в подложке (Demoland) вместо региона — город.
import { useMemo } from "react";
import type { MarketBundle, MarketLocation } from "@/types";
import { formatClass, type FormatClass, periods, trend, type TrendRow } from "@/lib/marketInsights";
import { areaOf, pathRings, project } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { useShape } from "./MapBase";
import { mono, Section } from "./ui";

const SEGMENT: Record<string, [string, string]> = {
  pizza: ["Пицца", "Pizza"],
  burger: ["Бургеры", "Burgers"],
  chicken: ["Курица", "Chicken"],
  grill: ["Гриль", "Grill"],
  asian: ["Азия", "Asian"],
  sandwich: ["Сэндвичи", "Sandwiches"],
  coffee: ["Кофе", "Coffee"],
  bakery: ["Пекарни", "Bakeries"],
  other: ["Другое", "Other"],
};
const FORMAT: Record<FormatClass, [string, string]> = {
  street: ["стрит", "street"],
  mall: ["ТЦ / ритейл-парк", "mall / retail park"],
  drive: ["drive-thru", "drive-thru"],
  highway: ["трасса", "highway"],
};
const ROWS = 6;
const EARLY = "color-mix(in srgb, var(--ink-mute) 32%, transparent)";
const RECENT = "var(--mkt-s7)";

function Bars({ title, rows, max }: { title: string; rows: TrendRow[]; max: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2.5 font-semibold text-ink" style={{ fontSize: 13 }}>{title}</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.group} className="grid grid-cols-[minmax(0,40%)_1fr] items-center gap-2" style={{ fontSize: 12.5 }}>
            <span className="text-ink-soft">{r.group}</span>
            <span className="flex flex-col gap-1">
              {(["early", "recent"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 rounded-sm"
                    style={{ width: `${(r[k] / max) * 80}%`, minWidth: r[k] ? 3 : 0, background: k === "early" ? EARLY : RECENT }}
                  />
                  <span className="text-ink-mute" style={{ ...mono, fontSize: 10.5 }}>{r[k].toFixed(1)}</span>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketTrend({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const { shape } = useShape(bundle.country);
  const now = useMemo(() => new Date(), []);
  const p = periods(now);
  const bakery = useMemo(() => new Set(bundle.chains.filter((c) => c.is_bakery).map((c) => c.key)), [bundle.chains]);
  const segment = useMemo(() => new Map(bundle.chains.map((c) => [c.key, c.segment])), [bundle.chains]);

  const groups = useMemo(() => {
    const areas = shape?.areas?.map((a) => ({ ...a, rings: pathRings(a.path) }));
    const region = (l: MarketLocation) => {
      if (!areas || !shape) return l.city;
      const a = areaOf(areas, project(shape.proj, l.lat, l.lng));
      return a ? (ru ? a.ru : a.en) : null;
    };
    const seg = (l: MarketLocation) => {
      const s = segment.get(l.chain_key) ?? "other";
      return dt(...(SEGMENT[s] ?? SEGMENT.other));
    };
    const fmt = (l: MarketLocation) => {
      const f = formatClass(l.format, l.name);
      return f ? dt(...FORMAT[f]) : null;
    };
    return [
      { title: areas ? dt("Регион", "Region") : dt("Город", "City"), rows: trend(bundle.locations, bakery, p, region) },
      { title: dt("Тип еды", "Food type"), rows: trend(bundle.locations, bakery, p, seg) },
      { title: dt("Формат", "Format"), rows: trend(bundle.locations, bakery, p, fmt) },
    ].map((g) => ({ ...g, rows: g.rows.slice(0, ROWS) })).filter((g) => g.rows.length);
  }, [shape, bundle.locations, bakery, segment, p.early[0], p.recentMonths, ru, dt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!groups.length) return null;
  const max = Math.max(0.1, ...groups.flatMap((g) => g.rows.flatMap((r) => [r.early, r.recent])));
  // Недавний период кончается последним полным месяцем.
  const until = new Date(now.getFullYear(), now.getMonth(), 0).toLocaleDateString(ru ? "ru-RU" : "en-GB");
  const e = `${p.early[0]}–${p.early[1]}`, r = `${p.recent[0]}–${p.recent[1]}`;
  return (
    <Section title={dt(`${e} против ${r}`, `${e} vs ${r}`)}>
      <p className="-mt-1 mb-2 max-w-[680px] text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          `Открытий в год, только точки с известной датой. ${r} — это ${p.recentMonths} мес. по ${until}, поэтому значения приведены к году.`,
          `Openings per year, only locations with a known date. ${r} covers ${p.recentMonths} months to ${until}, so values are annualised.`,
        )}
      </p>
      <div className="mb-3 flex flex-wrap gap-4 text-ink-soft" style={{ fontSize: 12 }}>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: EARLY }} />{dt(`${e}, в среднем за год`, `${e}, average per year`)}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: RECENT }} />{dt(`${r}, в среднем за год`, `${r}, average per year`)}</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        {groups.map((g) => <Bars key={g.title} title={g.title} rows={g.rows} max={max} />)}
      </div>
    </Section>
  );
}
