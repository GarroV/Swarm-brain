// Модель виджета «Карты и отзывы» из GET /quality/maps: строки стран подборки. Чистые функции без
// React, под тестами (homeMaps.test.ts). Список худших пиццерий снят 11.10.2026 по слову владельца.

import type { MapsCountry, MapsData } from "./api";

/** Страны подборки в порядке выбора пользователя; страны без строки в ответе пропускаются. */
export function mapsCountries(data: MapsData, codes: string[]): MapsCountry[] {
  return codes.flatMap((cc) => data.countries.find((c) => c.cc === cc) ?? []);
}
