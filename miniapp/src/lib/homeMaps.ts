// Модель виджета «Карты и отзывы» из GET /quality/maps: строки стран подборки и пиццерии с худшей
// оценкой Google. Чистые функции без React, под тестами (homeMaps.test.ts).

import type { MapsCountry, MapsData, MapsUnit } from "./api";

/** Сколько худших пиццерий показываем под таблицей стран. */
export const WORST_COUNT = 5;

export type WorstUnit = { id: string; name: string; cc: string; avg: number; prevAvg: number | null; change: number | null; reviews: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Страны подборки в порядке выбора пользователя; страны без строки в ответе пропускаются. */
export function mapsCountries(data: MapsData, codes: string[]): MapsCountry[] {
  return codes.flatMap((cc) => data.countries.find((c) => c.cc === cc) ?? []);
}

/** Худшие по оценке Google пиццерии подборки: без оценки не берём; при равной — больше отзывов выше. */
export function worstUnits(units: MapsUnit[], codes: string[], n = WORST_COUNT): WorstUnit[] {
  const set = new Set(codes);
  return units
    .filter((u) => set.has(u.cc) && u.maps.google?.avg != null)
    .map((u) => {
      const g = u.maps.google!;
      const avg = g.avg as number;
      return { id: u.id, name: u.name, cc: u.cc, avg, prevAvg: g.prev_avg, change: g.prev_avg == null ? null : round2(avg - g.prev_avg), reviews: g.reviews };
    })
    .sort((a, b) => a.avg - b.avg || b.reviews - a.reviews || a.name.localeCompare(b.name))
    .slice(0, n);
}
