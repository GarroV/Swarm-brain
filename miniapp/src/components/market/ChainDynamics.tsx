"use client";
// Динамика сетей эталона (#growth): мини-график .panel.mini на каждую сеть — точек на конец
// года, от года перед таймлайном до сегодня. Сети, счётчики и примечания — из ручной части
// (editorial.growth: keys, hist как SUB у Submarine, notes). Без неё — крупные сети по
// реестру; счётчик из справочника сети (chain.hist) важнее реестра. Точка без даты
// считается открытой с первого года графика, это подписано у сети, а не спрятано.
import { useMemo } from "react";
import type { MarketBundle } from "@/types";
import { growthSeries, TIMELINE_FROM } from "@/lib/marketInsights";
import { aliveAtYearEnd } from "@/lib/marketStats";
import { useDt } from "@/components/roy/nav";
import { RefSection, Sw, useChainColor, useEditorial } from "./ref";
import { SourceCaption } from "./ui";

// Без ручной части — столько крупнейших сетей.
const TOP = 8;
// Геометрия эталона: 240×86, столбец 24, низ под подписи 14, верх под значение 30.
const W = 240, H = 86, BW = 24;

type Series = { key: string; name: string; vals: number[]; note: string | null };

function Mini({ s, years, color, dt }: { s: Series; years: number[]; color: string; dt: (ru: string, en: string) => string }) {
  const n = years.length;
  const max = Math.max(...s.vals, 1);
  const gap = n > 1 ? (W - BW * n) / (n - 1) : 0;
  const last = s.vals[n - 1] ?? 0;
  const d = last - (s.vals[0] ?? 0);
  return (
    <div className="panel mini">
      <div className="top">
        <h3><Sw color={color} inline />{s.name}</h3>
        <b>{last}</b>
      </div>
      <div className="delta">
        {dt(`${d > 0 ? `+${d}` : d} с конца ${years[0]}`, `${d > 0 ? `+${d}` : d} since end of ${years[0]}`)}
        {s.note ? ` · ${s.note}` : ""}
      </div>
      <svg viewBox={`0 -4 ${W} ${H + 4}`} width="100%" role="img" aria-label={`${s.name}: ${s.vals.join(", ")}`}>
        {s.vals.map((v, i) => {
          const bh = (v / max) * (H - 30), x = i * (BW + gap), y = H - 14 - bh;
          const edge = i === 0 || i === n - 1;
          return (
            <g key={years[i]}>
              {v > 0 && (
                <path
                  d={`M${x},${H - 14}V${y + 3}Q${x},${y} ${x + 3},${y}H${x + BW - 3}Q${x + BW},${y} ${x + BW},${y + 3}V${H - 14}Z`}
                  fill={color}
                  opacity={i === n - 1 ? 1 : 0.55}
                >
                  <title>{`${years[i]}: ${v}`}</title>
                </path>
              )}
              {edge && <text x={x + BW / 2} y={H - 2} textAnchor="middle">{years[i]}</text>}
              {edge && v > 0 && <text x={x + BW / 2} y={y - 4} textAnchor="middle" style={{ fill: "var(--ink2)" }}>{v}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ChainDynamics({ bundle }: { bundle: MarketBundle }) {
  const dt = useDt();
  const ed = useEditorial(bundle);
  const col = useChainColor(bundle);
  const now = useMemo(() => new Date(), []);
  const thisYear = now.getFullYear();
  const from = TIMELINE_FROM - 1;
  const years = useMemo(() => Array.from({ length: thisYear - from + 1 }, (_, i) => from + i), [from, thisYear]);
  const curated = ed.growth;

  const series = useMemo((): Series[] => {
    const byKey = new Map(bundle.chains.map((c) => [c.key, c]));
    const chainHist = (key: string) => {
      const h = byKey.get(key)?.hist;
      return h?.length ? Object.fromEntries(h.map((p) => [p.year, p.count])) : null;
    };
    const build = (key: string, note: string | null): Series => ({
      key,
      name: byKey.get(key)?.name ?? key,
      vals: growthSeries(bundle.locations, key, years, curated?.hist[key] ?? chainHist(key), thisYear),
      note,
    });
    if (curated) return curated.keys.filter((k) => byKey.has(k)).map((k) => build(k, curated.notes[k] ?? null));
    // Сеть, у которой ни одна точка не датирована (и нет счётчика), роста не показывает —
    // плоская карточка читалась бы как «рост ноль», поэтому такие сети сюда не попадают.
    const undated = (key: string) => aliveAtYearEnd(bundle.locations.filter((l) => l.chain_key === key && !l.opened), thisYear, thisYear);
    return bundle.chains
      .filter((c) => !c.is_bakery)
      .filter((c) => chainHist(c.key) || bundle.locations.some((l) => l.chain_key === c.key && Number(l.opened?.slice(0, 4)) > from))
      .map((c) => {
        const u = chainHist(c.key) ? 0 : undated(c.key);
        return build(c.key, u ? dt(`${u} точек без даты`, `${u} undated`) : null);
      })
      .filter((s) => (s.vals.at(-1) ?? 0) > 0)
      .sort((a, b) => (b.vals.at(-1) ?? 0) - (a.vals.at(-1) ?? 0))
      .slice(0, TOP);
  }, [bundle.chains, bundle.locations, curated, years, thisYear, from, dt]);

  if (!series.length) return null;

  return (
    <RefSection
      id="growth"
      eyebrow={dt("Динамика сетей", "Chain dynamics")}
      title={dt("Число точек на конец года", "Locations at year end")}
      lede={ed.texts.growth ?? dt(
        `Посчитано по датам открытия и закрытия из реестра ниже. Точки без даты считаются открытыми до ${TIMELINE_FROM} года, поэтому у сетей с такими точками рост скорее занижен.`,
        `Counted from opening and closing dates in the registry below. Undated locations count as open before ${TIMELINE_FROM}, so growth of chains with such locations is likely understated.`,
      )}
    >
      <div className="multi">
        {series.map((s) => <Mini key={s.key} s={s} years={years} color={col(s.key)} dt={dt} />)}
      </div>
      <SourceCaption bundle={bundle} feeds={curated ? ["locations", "editorial"] : "locations"} />
    </RefSection>
  );
}
