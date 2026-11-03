// Геометрия «Анализа рынка»: расстояние и сопоставление точек одной сети из разных источников.
const EARTH_M = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export type GeoPoint = { lat: number; lng: number };

export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

export const MATCH_RADIUS_M = 150;

export type MatchResult<E, P> = { matched: Array<{ existing: E; found: P }>; unmatched: P[]; missing: E[] };

/** Сетка для поиска соседей: ячейка не меньше радиуса, так что пара всегда в соседних ячейках.
 *  Без неё сопоставление было «каждая с каждой» — на 8 тыс. точек Испании функция приёма упиралась
 *  в лимит процессорного времени (02.11.2026, HTTP 546). Рассчитана на широты до ~80°. */
const cellDeg = (radiusM: number) => Math.max(0.01, radiusM / 30000);
const cellOf = (p: GeoPoint, size: number) => [Math.floor(p.lat / size), Math.floor(p.lng / size)] as const;
const cellKey = (chain: string, i: number, j: number) => `${chain}|${i}|${j}`;

function gridOf<T extends { chain: string } & GeoPoint>(items: T[], size: number): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  items.forEach((p, idx) => {
    const [i, j] = cellOf(p, size);
    const k = cellKey(p.chain, i, j);
    const cell = grid.get(k);
    if (cell) cell.push(idx);
    else grid.set(k, [idx]);
  });
  return grid;
}

/** Индексы точек сетки в окрестности p (той же сети), по возрастанию. */
function nearIdx(grid: Map<string, number[]>, p: { chain: string } & GeoPoint, size: number): number[] {
  const [i, j] = cellOf(p, size);
  const out: number[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) out.push(...(grid.get(cellKey(p.chain, i + di, j + dj)) ?? []));
  }
  return out.sort((a, b) => a - b);
}

/** Пара — та же сеть и ближе radiusM. Жадно по возрастанию расстояния: одна точка базы
 *  сопоставляется не больше одного раза, иначе два соседних McDonald's слиплись бы в один. */
export function matchPoints<
  E extends { id: string; chain: string } & GeoPoint,
  P extends { chain: string } & GeoPoint,
>(existing: E[], found: P[], radiusM = MATCH_RADIUS_M): MatchResult<E, P> {
  const size = cellDeg(radiusM);
  const grid = gridOf(found, size);
  const pairs: Array<{ e: number; f: number; d: number }> = [];
  existing.forEach((e, ei) => {
    for (const fi of nearIdx(grid, e, size)) {
      const d = distanceM(e, found[fi]);
      if (d <= radiusM) pairs.push({ e: ei, f: fi, d });
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedE = new Set<number>(), usedF = new Set<number>();
  const matched: Array<{ existing: E; found: P }> = [];
  for (const p of pairs) {
    if (usedE.has(p.e) || usedF.has(p.f)) continue;
    usedE.add(p.e);
    usedF.add(p.f);
    matched.push({ existing: existing[p.e], found: found[p.f] });
  }
  return {
    matched,
    unmatched: found.filter((_, i) => !usedF.has(i)),
    missing: existing.filter((_, i) => !usedE.has(i)),
  };
}

/** На сколько координаты одной точки расходятся между источниками, когда совпадает адрес:
 *  снимок ставит точку по адресу, OSM — по зданию (Хорватия: до 3 км у трассы). */
export const SAME_ADDRESS_RADIUS_M = 5000;

/** «Ulica kneza Mislava 1, 10000 Zagreb (…)» → «kneza mislava 1»: до запятой и скобки, без
 *  диакритики и слова «ulica». Без номера дома адрес ничего не доказывает — null. */
export function streetKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const s = address.split(/[,(]/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\bul(ica)?\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return /\d/.test(s) && /[a-z]{3}/.test(s) ? s : null;
}

type PlaceRef = { chain: string; address?: string | null } & GeoPoint;

/** Проверка «та же точка той же сети» сразу для многих точек против одного набора refs:
 *  ближе radiusM — или тот же адрес (улица и дом) в пределах 5 км. Набор индексируется один раз. */
export function placeMatcher(refs: PlaceRef[], radiusM = MATCH_RADIUS_M): (p: PlaceRef) => boolean {
  const size = cellDeg(radiusM);
  const grid = gridOf(refs, size);
  const byStreet = new Map<string, PlaceRef[]>();
  for (const r of refs) {
    const k = streetKey(r.address);
    if (k === null) continue;
    const id = `${r.chain}|${k}`;
    const list = byStreet.get(id);
    if (list) list.push(r);
    else byStreet.set(id, [r]);
  }
  return (p) => {
    if (nearIdx(grid, p, size).some((i) => distanceM(refs[i], p) <= radiusM)) return true;
    const key = streetKey(p.address);
    return key !== null &&
      (byStreet.get(`${p.chain}|${key}`) ?? []).some((r) => distanceM(r, p) <= SAME_ADDRESS_RADIUS_M);
  };
}

/** Та же точка той же сети: ближе radiusM — или тот же адрес (улица и дом) в пределах 5 км. */
export function samePlace(p: PlaceRef, refs: PlaceRef[], radiusM = MATCH_RADIUS_M): boolean {
  return placeMatcher(refs, radiusM)(p);
}
