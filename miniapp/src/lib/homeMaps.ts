// Оценки карт для «Моих стран» из GET /quality/maps: строка страны и оценки каждой пиццерии. Чистые
// функции без React, под тестами (homeMaps.test.ts). Отдельный виджет «Карты и отзывы» снят 11.10.2026:
// владелец велел объединить его с «Моими странами».

import type { MapsCountry, MapsData, MapsUnit, MapsUnitStat } from "./api";

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

// Вкладка «Карты» блока «Рейтинги»: итог по выбранным странам.

/** Порог «низкой» оценки Google: пиццерии ниже него вынесены в плашку. */
export const MAPS_LOW = 4.5;

export type MapsKind = "google" | "yandex";
export type MapsTotal = { avg: number | null; delta: number | null; reviews: number };
export type MapsSummary = {
  google: MapsTotal;
  yandex: MapsTotal;
  /** Среднее по всем странам ответа («IMF», как у РКО): ответ уже режется по странам воркспейса. */
  imf: { google: MapsTotal; yandex: MapsTotal };
  /** Есть ли у выбранных стран хоть одна оценка Яндекса: нет — плашку не рисуем. */
  hasYandex: boolean;
  /** Пиццерии с оценкой Google ниже MAPS_LOW, худшие первыми. */
  low: MapsUnit[];
  /** Пиццерии без отзывов на Google (нет оценки или ноль отзывов). */
  noReviews: MapsUnit[];
  rows: MapsCountry[];
};

/** Среднее по странам, взвешенное числом отзывов (как считает Децимус); изменение — тем же весом по странам, где оно есть. */
export function weightedMaps(rows: MapsCountry[], kind: MapsKind): MapsTotal {
  let reviews = 0, sum = 0, w = 0, dSum = 0, dW = 0;
  for (const c of rows) {
    const m = c.maps[kind];
    reviews += m.reviews;
    if (m.avg != null && m.reviews > 0) { sum += m.avg * m.reviews; w += m.reviews; }
    if (m.delta != null && m.reviews > 0) { dSum += m.delta * m.reviews; dW += m.reviews; }
  }
  return { avg: w ? round2(sum / w) : null, delta: dW ? round2(dSum / dW) : null, reviews };
}

export function mapsSummary(data: MapsData, codes: string[]): MapsSummary {
  const want = new Set(codes);
  const rows = data.countries.filter((c) => want.has(c.cc));
  const units = data.units.filter((u) => want.has(u.cc));
  const low = units
    .filter((u) => u.maps.google?.avg != null && u.maps.google.avg < MAPS_LOW)
    .sort((a, b) => (a.maps.google?.avg ?? 0) - (b.maps.google?.avg ?? 0));
  const noReviews = units.filter((u) => !u.maps.google || u.maps.google.avg == null || u.maps.google.reviews === 0);
  return {
    google: weightedMaps(rows, "google"),
    yandex: weightedMaps(rows, "yandex"),
    imf: { google: weightedMaps(data.countries, "google"), yandex: weightedMaps(data.countries, "yandex") },
    hasYandex: rows.some((c) => c.maps.yandex.avg != null),
    low,
    noReviews,
    rows,
  };
}
