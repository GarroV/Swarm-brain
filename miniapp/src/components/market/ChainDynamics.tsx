"use client";
// Динамика сетей по образцу референса: мини-график на каждую из крупных сетей — точек на
// конец года, от года перед ранним периодом до сегодня. Считается из дат открытия и
// закрытия в реестре; точка без даты считается открытой с первого года графика, это
// подписано у сети, а не спрятано.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import { chainColors } from "@/lib/marketMap";
import { periods } from "@/lib/marketInsights";
import { aliveAtYearEnd, unitsByYear } from "@/lib/marketStats";
import { useDt } from "@/components/roy/nav";
import { mono, Section, SourceCaption } from "./ui";

const TOP = 8;
const BAR_H = 64;

export function ChainDynamics({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const now = useMemo(() => new Date(), []);
  const thisYear = now.getFullYear();
  const from = periods(now).early[0] - 1;
  const years = useMemo(() => Array.from({ length: thisYear - from + 1 }, (_, i) => from + i), [from, thisYear]);
  const colors = useMemo(() => chainColors(bundle.chains, bundle.locations), [bundle.chains, bundle.locations]);
  const regular = useMemo(() => bundle.chains.filter((c) => !c.is_bakery), [bundle.chains]);
  const series = useMemo(() => {
    const locs = bundle.locations.map((l) => ({ chain: l.chain_key, opened: l.opened, status: l.status, closed: l.closed }));
    return unitsByYear(locs, regular.map((c) => c.key), years);
  }, [bundle.locations, regular, years]);
  const ranked = useMemo(
    // Сеть, у которой ни одна точка не датирована, роста не показывает — плоская карточка
    // читалась бы как «рост ноль», поэтому такие сети сюда не попадают.
    () =>
      [...regular]
        .filter((c) => bundle.locations.some((l) => l.chain_key === c.key && Number(l.opened?.slice(0, 4)) > from))
        .sort((a, b) => (series[b.key]?.at(-1) ?? 0) - (series[a.key]?.at(-1) ?? 0))
        .filter((c) => (series[c.key]?.at(-1) ?? 0) > 0)
        .slice(0, TOP),
    [regular, series, bundle.locations, from],
  );
  if (!ranked.length) return null;

  return (
    <Section title={dt("Число точек на конец года", "Locations at year end")}>
      <p className="-mt-1 mb-3 max-w-[680px] text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          `Посчитано по датам открытия и закрытия из реестра ниже. Точки без даты считаются открытыми до ${from + 1} года, поэтому у сетей с такими точками рост скорее занижен.`,
          `Counted from opening and closing dates in the registry below. Undated locations count as open before ${from + 1}, so growth of chains with such locations is likely understated.`,
        )}
      </p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {ranked.map((c) => {
          const v = series[c.key] ?? [];
          const max = Math.max(1, ...v);
          const color = colors.get(c.key) ?? "var(--mkt-s0)";
          const undated = aliveAtYearEnd(bundle.locations.filter((l) => l.chain_key === c.key && !l.opened), thisYear);
          const first = v.findIndex((n) => n > 0);
          return (
            <div key={c.key} className="rounded-xl border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold text-ink" style={{ fontSize: 13 }}>
                  <span className="inline-block size-2.5 rounded-full" style={{ background: color }} />
                  {c.name}
                </span>
                <span className="font-semibold text-ink" style={{ fontSize: 20, lineHeight: 1 }}>{v.at(-1)}</span>
              </div>
              <div className="mt-1 text-ink-mute" style={{ fontSize: 11.5 }}>
                {dt(`+${(v.at(-1) ?? 0) - (v[0] ?? 0)} с конца ${from}`, `+${(v.at(-1) ?? 0) - (v[0] ?? 0)} since end of ${from}`)}
                {undated ? dt(` · ${undated} точек без даты`, ` · ${undated} undated`) : ""}
              </div>
              <div className="mt-2 flex items-end gap-1" style={{ height: BAR_H + 14 }}>
                {v.map((n, i) => (
                  <div key={years[i]} className="flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }} title={`${years[i]}: ${n}`}>
                    {(i === first || i === v.length - 1) && n > 0 && <span className="text-ink-soft" style={{ ...mono, fontSize: 10 }}>{n}</span>}
                    <div className="w-full rounded-t-sm" style={{ height: (n / max) * BAR_H, background: color, opacity: i === v.length - 1 ? 1 : 0.55 }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-ink-mute" style={{ ...mono, fontSize: 10 }}>
                <span>{from}</span>
                <span>{thisYear}</span>
              </div>
            </div>
          );
        })}
      </div>
      <SourceCaption bundle={bundle} feeds="locations" />
    </Section>
  );
}
