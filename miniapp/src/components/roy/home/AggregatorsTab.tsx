"use client";
import { useDt } from "../nav";
import { Delta, Stat, card } from "./QualityWidgets";
import { useAggregators } from "./useAggregators";
import { countryName } from "@/lib/countries";
import { aggregatorTotals, deltaDigits, scoreDigits } from "@/lib/homeAggregators";

// Вкладка «Агрегаторы» блока «Рейтинги»: по плашке на агрегатора — оценка выбранных стран на его шкале
// против среднего по IMF (всем странам ответа) и изменение за 30 дней. Шкалы разные (5/10/100):
// оценки разных агрегаторов не смешиваются и всегда подписаны шкалой. Источник — GET /quality/aggregators.

const note = "rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-ink-mute";
const num = (v: number | null, digits: number) => (v == null ? "—" : v.toFixed(digits));

export function AggregatorsTab({ codes }: { codes: string[] }) {
  const dt = useDt();
  const { data, loading, failed, retry } = useAggregators();
  if (loading) return <div className="roy-shim" style={{ height: 220, borderRadius: 12 }} />;
  if (failed || !data) {
    return (
      <div className={note} style={{ fontSize: 13 }}>
        {dt("Оценки агрегаторов не загрузились.", "Couldn't load delivery-app ratings.")}{" "}
        <button type="button" onClick={retry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button>
      </div>
    );
  }
  const mine = aggregatorTotals(data, codes);
  if (!mine.length) return <div className={note} style={{ fontSize: 13 }}>{dt("В выбранных странах агрегаторы не собираются", "Delivery apps aren't tracked in the selected countries")}</div>;
  const imf = new Map(aggregatorTotals(data, data.countries.map((c) => c.cc)).map((a) => [a.key, a]));
  const rows = data.countries.filter((c) => codes.includes(c.cc) && Object.keys(c.scores).length);
  const title = new Map(data.aggregators.map((a) => [a.key, a]));
  return (
    <div className={card}>
      <div className="grid grid-cols-2 gap-2 min-[1400px]:grid-cols-3">
        {mine.map((a) => {
          const d = scoreDigits(a.scale);
          return (
            <Stat key={a.key} label={a.title}
              value={<>{num(a.avg, d)}<small className="ml-0.5 font-medium text-ink-mute" style={{ fontSize: 12 }}>/{a.scale}</small>{" "}
                <Delta v={a.delta} digits={deltaDigits(a.scale)} small /></>}
              note={dt(`IMF ${num(imf.get(a.key)?.avg ?? null, d)} · ${a.pizzerias} пицц.`, `IMF ${num(imf.get(a.key)?.avg ?? null, d)} · ${a.pizzerias} pizzerias`)} />
          );
        })}
      </div>
      <div className="flex flex-col" style={{ fontSize: 12.5 }}>
        {rows.map((c) => (
          <div key={c.cc} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-t border-line py-1.5 first:border-t-0">
            <span className="min-w-[88px] text-ink">{dt(countryName(c.cc), c.cc)}</span>
            {Object.entries(c.scores).map(([key, s]) => {
              const a = title.get(key);
              return (
                <span key={key} className="whitespace-nowrap font-mono text-ink">
                  <span className="font-sans text-ink-mute">{a?.title ?? key}</span> {num(s.avg, scoreDigits(s.scale))}<span className="text-ink-mute">/{s.scale}</span>{" "}
                  <Delta v={s.delta} digits={deltaDigits(s.scale)} small />
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
