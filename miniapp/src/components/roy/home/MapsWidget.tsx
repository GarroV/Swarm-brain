"use client";
import { useMemo } from "react";
import { useDt } from "../nav";
import { Delta } from "./QualityWidgets";
import { useMaps } from "./useMaps";
import type { MapsStat } from "@/lib/api";
import { countryFlag, countryName } from "@/lib/countries";
import { mapsCountries } from "@/lib/homeMaps";

// «Карты и отзывы»: по странам подборки — средняя оценка Google и Яндекса, изменение за 30 дней, число
// отзывов. Список худших пиццерий снят (владелец 11.10.2026: «худшую оценку убери»). Источник — Децимус (GET /quality/maps).

const card = "rounded-[12px] border border-line bg-surface";
const th = "px-2.5 py-2 text-left font-semibold uppercase text-ink-mute";
const td = "border-t border-line px-2.5 py-2";
const note = "rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-ink-mute";

function Rating({ s }: { s: MapsStat }) {
  if (s.avg == null) return <span className="text-ink-mute">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono font-semibold text-ink">{s.avg.toFixed(2)}</span><span className="text-[#E8A400]"> ★</span>{" "}
      <Delta v={s.delta} digits={2} small />
    </span>
  );
}

export function MapsWidget({ codes }: { codes: string[] }) {
  const dt = useDt();
  const { data, loading, failed, retry } = useMaps();
  const rows = useMemo(() => (data ? mapsCountries(data, codes) : []), [data, codes]);

  if (loading) return <div className="roy-shim" style={{ height: 220, borderRadius: 12 }} />;
  if (failed || !data) {
    return (
      <div className={note} style={{ fontSize: 13 }}>
        {dt("Рейтинги карт не загрузились.", "Couldn't load map ratings.")}{" "}
        <button type="button" onClick={retry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button>
      </div>
    );
  }
  if (!rows.some((c) => c.maps.google.avg != null || c.maps.yandex.avg != null)) {
    return <div className={note} style={{ fontSize: 13 }}>{dt("Рейтинги карт по этим странам ещё не загружены", "Map ratings for these countries haven't been loaded yet")}</div>;
  }
  return (
    <div className={card}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
            <tr>
              <th className={th}>{dt("Страна", "Country")}</th>
              <th className={th}>Google</th><th className={`${th} text-right`}>{dt("Отзывов", "Reviews")}</th>
              <th className={th}>{dt("Яндекс", "Yandex")}</th><th className={`${th} text-right`}>{dt("Отзывов", "Reviews")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.cc} className="hover:bg-surface-2">
                <td className={td}><span className="mr-1">{countryFlag(c.cc)}</span><span className="font-medium text-ink">{dt(countryName(c.cc), c.cc)}</span></td>
                <td className={td}><Rating s={c.maps.google} /></td>
                <td className={`${td} text-right font-mono text-ink-soft`}>{c.maps.google.reviews.toLocaleString()}</td>
                <td className={td}><Rating s={c.maps.yandex} /></td>
                <td className={`${td} text-right font-mono text-ink-soft`}>{c.maps.yandex.reviews.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
