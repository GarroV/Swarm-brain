// Оценки карт для «Моих стран» из GET /quality/maps: строка страны и оценки каждой пиццерии. Чистые
// функции без React, под тестами (homeMaps.test.ts). Отдельный виджет «Карты и отзывы» снят 11.10.2026:
// владелец велел объединить его с «Моими странами».

import type { MapsCountry, MapsData, MapsUnitStat } from "./api";

export type UnitMaps = { google: MapsUnitStat | null; yandex: MapsUnitStat | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Строка карт страны; нет данных или страны в ответе — null. */
export function countryMaps(data: MapsData | null, cc: string): MapsCountry | null {
  return data?.countries.find((c) => c.cc === cc) ?? null;
}

/**
 * Оценки карт по пиццерии. Ключ — dodo_id в нижнем регистре: его же отдают рейтинги РС/РКО
 * (`Pizzeria.key`), а название на картах — гугловское («Dodo Pizza»), склеивать по нему нельзя.
 */
export function mapsByUnit(data: MapsData | null): Map<string, UnitMaps> {
  return new Map((data?.units ?? []).map((u) => [u.id.toLowerCase(), u.maps]));
}

/** Изменение оценки к дате сравнения; нет одной из оценок — null (стрелку не рисуем). */
export function unitChange(s: MapsUnitStat | null): number | null {
  return s?.avg == null || s.prev_avg == null ? null : round2(s.avg - s.prev_avg);
}
