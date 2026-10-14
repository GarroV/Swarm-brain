// Ответ Децимуса GET /api/v1/maps/ratings → формат GET /quality/maps. Чистый модуль под тестом
// (maps-view.test.ts): рейтинги карт читаются на экране как факт.

export type CountryMap = { avg: number | null; reviews: number; branches: number; delta: number | null };
export type UnitMap = { avg: number | null; reviews: number; prev_avg: number | null };
export type MapsCountry = { cc: string; as_of: string | null; maps: { google: CountryMap; yandex: CountryMap } };
export type MapsUnit = {
  id: string;
  name: string;
  cc: string;
  city: string | null;
  maps: { google: UnitMap | null; yandex: UnitMap | null };
};
export type MapsView = {
  on: string;
  compare: string | null;
  countries: MapsCountry[];
  units: MapsUnit[];
  loaded_at: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (what: string): never => {
  throw new Error(`decimus: ${what}`);
};
const rec = (v: unknown, what: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : bad(what);
const avg = (v: unknown): number | null =>
  v === null ? null : typeof v === "number" && v >= 0 && v <= 5 ? v : bad("оценка вне 0–5");
const count = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : bad("число не целое или отрицательное");
const delta = (v: unknown): number | null =>
  v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : bad("кривое изменение");
const date = (v: unknown, what: string): string => typeof v === "string" && DATE.test(v) ? v : bad(what);
const code = (v: unknown): string => {
  const cc = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(cc) ? cc : bad("кривой код страны");
};

function countryMap(v: unknown): CountryMap {
  const m = rec(v, "нет карты страны");
  return { avg: avg(m.avg), reviews: count(m.reviews), branches: count(m.branches), delta: delta(m.delta) };
}

function unitMap(v: unknown): UnitMap | null {
  if (v === null) return null;
  const m = rec(v, "кривая карта пиццерии");
  return { avg: avg(m.avg), reviews: count(m.reviews), prev_avg: avg(m.prev_avg) };
}

/** Ответ Децимуса → наш формат. Чужим данным не верим: кривое поле — ошибка, а не тихий ноль;
 * проверяется всё, в том числе строки вне разрешённых стран — порчу фильтром не прячем. */
export function toMapsView(body: unknown, countries: string[] | null): MapsView {
  const b = rec(body, "ответ не объект");
  if (!Array.isArray(b.countries) || !Array.isArray(b.units)) bad("нет countries/units");
  const allow = countries ? new Set(countries) : null;
  const outCountries: MapsCountry[] = [];
  for (const raw of b.countries as unknown[]) {
    const c = rec(raw, "кривая страна");
    const maps = rec(c.maps, "нет maps страны");
    const row: MapsCountry = {
      cc: code(c.cc),
      as_of: c.as_of == null ? null : date(c.as_of, "кривая as_of"),
      maps: { google: countryMap(maps.google), yandex: countryMap(maps.yandex) },
    };
    if (!allow || allow.has(row.cc)) outCountries.push(row);
  }
  const units: MapsUnit[] = [];
  for (const raw of b.units as unknown[]) {
    const u = rec(raw, "кривая пиццерия");
    if (typeof u.id !== "string" || !u.id || typeof u.name !== "string") bad("кривая пиццерия");
    const maps = rec(u.maps, "нет maps пиццерии");
    const row: MapsUnit = {
      id: u.id as string,
      name: u.name as string,
      cc: code(u.cc),
      city: typeof u.city === "string" ? u.city : null,
      maps: { google: unitMap(maps.google ?? null), yandex: unitMap(maps.yandex ?? null) },
    };
    if (!allow || allow.has(row.cc)) units.push(row);
  }
  return {
    on: date(b.on, "кривая on"),
    compare: b.compare == null ? null : date(b.compare, "кривая compare"),
    countries: outCountries,
    units,
    loaded_at: typeof b.loaded_at === "string" ? b.loaded_at : null,
  };
}
