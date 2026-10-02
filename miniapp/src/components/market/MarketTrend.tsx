"use client";
// Тренд запусков эталона (#trend): открытий в год в раннем периоде против недавнего,
// по регионам, типу еды и формату — три .panel.cmpbox со строками .crow. Только точки с известной датой; недавний период ещё
// идёт, поэтому приведён к году. Регион — укрупнённый (AREAS в build-shapes.ts); у страны
// без регионов в подложке (Demoland) вместо региона — город.
import { useMemo } from "react";
import type { MarketBundle, MarketLocation } from "@/types";
import { formatClass, type FormatClass, periods, trend, type TrendRow } from "@/lib/marketInsights";
import { areaOf, pathRings, project } from "@/lib/marketView";
import { useDt, useLang } from "@/components/roy/nav";
import { useShape } from "./MapBase";
import { RefSection, useEditorial } from "./ref";
import { SourceCaption } from "./ui";

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
// У страны без регионов в подложке группа — город: их десятки, показываем первые.
const CITY_ROWS = 6;

/** Блок эталона: ширина полоски — доля от максимума в этом блоке, 80% у самой длинной. */
function CmpBox({ title, rows }: { title: string; rows: TrendRow[] }) {
  const mx = Math.max(0.1, ...rows.flatMap((r) => [r.early, r.recent]));
  return (
    <div className="panel cmpbox">
      <h3>{title}</h3>
      {rows.map((r) => (
        <div key={r.group} className="crow">
          <span>{r.group}</span>
          <span className="bars">
            <span className="b"><i className="tone-a" style={{ width: `${(r.early / mx) * 80}%` }} />{r.early.toFixed(1)}</span>
            <span className="b"><i className="tone-b" style={{ width: `${(r.recent / mx) * 80}%` }} />{r.recent.toFixed(1)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function MarketTrend({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ru = useLang() === "ru";
  const { shape } = useShape(bundle.country);
  const ed = useEditorial(bundle);
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
      { title: areas ? dt("Регион", "Region") : dt("Город", "City"), rows: trend(bundle.locations, bakery, p, region).slice(0, areas ? undefined : CITY_ROWS) },
      { title: dt("Тип еды", "Food type"), rows: trend(bundle.locations, bakery, p, seg) },
      { title: dt("Формат", "Format"), rows: trend(bundle.locations, bakery, p, fmt) },
    ].filter((g) => g.rows.length);
  }, [shape, bundle.locations, bakery, segment, p.early[0], p.recentMonths, ru, dt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!groups.length) return null;
  // Недавний период кончается последним полным месяцем.
  const until = new Date(now.getFullYear(), now.getMonth(), 0).toLocaleDateString(ru ? "ru-RU" : "en-GB");
  const e = `${p.early[0]}–${p.early[1]}`, r = `${p.recent[0]}–${p.recent[1]}`;
  return (
    <RefSection
      id="trend"
      eyebrow={dt("Тренд запусков", "Launch trend")}
      title={dt(`${e} против ${r}`, `${e} vs ${r}`)}
      lede={ed.texts.trend ?? dt(
        `Открытий в год, только точки с известной датой. ${r} — это ${p.recentMonths} мес. по ${until}, поэтому значения приведены к году.`,
        `Openings per year, only locations with a known date. ${r} covers ${p.recentMonths} months to ${until}, so values are annualised.`,
      )}
    >
      <div className="legend">
        <span><i className="sw tone-a" style={{ borderRadius: 2 }} />{dt(`${e}, в среднем за год`, `${e}, average per year`)}</span>
        <span><i className="sw tone-b" style={{ borderRadius: 2 }} />{dt(`${r}, в среднем за год`, `${r}, average per year`)}</span>
      </div>
      <div className="cmp">
        {groups.map((g) => <CmpBox key={g.title} title={g.title} rows={g.rows} />)}
      </div>
      <SourceCaption bundle={bundle} feeds="locations" />
    </RefSection>
  );
}
