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

// Сетка для поиска соседей: перебор «каждая с каждой» на тысячах точек одной сети (Испания,
// Польша) съедал лимит процессора функции (HTTP 546, #1108). Ячейка 0,01° (~1,1 км по широте);
// запрос смотрит соседние ячейки в границах радиуса, так что результат тот же, что у перебора.
const CELL_DEG = 0.01;
const LNG_CELLS = Math.round(360 / CELL_DEG);
/** Метров в градусе дуги на шаре EARTH_M, с запасом 2% против округления. */
const M_PER_DEG = ((2 * Math.PI * EARTH_M) / 360) / 1.02;
const MAX_SCAN_CELLS = 400;
const latCell = (lat: number) => Math.floor(lat / CELL_DEG);
const lngCell = (lng: number) => ((Math.floor(lng / CELL_DEG) % LNG_CELLS) + LNG_CELLS) % LNG_CELLS;
const cellKey = (cx: number, cy: number) => cx * 100000 + cy;

type IndexedRef = { chain: string; address?: string | null } & GeoPoint;

/** Индекс опорных точек: кто в радиусе (сетка) и кто на той же улице (по ключу адреса).
 *  Индексы возвращаются по возрастанию — порядок обхода как у полного перебора. */
export class PlaceIndex<R extends IndexedRef> {
  private readonly chains = new Map<string, {
    all: number[];
    cells: Map<number, number[]>;
    streets: Map<string, number[]>;
  }>();
  constructor(readonly refs: R[]) {
    refs.forEach((r, i) => {
      let c = this.chains.get(r.chain);
      if (!c) this.chains.set(r.chain, c = { all: [], cells: new Map(), streets: new Map() });
      c.all.push(i);
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
        const k = cellKey(lngCell(r.lng), latCell(r.lat));
        const cell = c.cells.get(k);
        if (cell) cell.push(i);
        else c.cells.set(k, [i]);
      }
      const sk = streetKey(r.address);
      if (sk !== null) {
        const l = c.streets.get(sk);
        if (l) l.push(i);
        else c.streets.set(sk, [i]);
      }
    });
  }

  /** Индексы точек той же сети, которые могут оказаться ближе radiusM (надмножество). */
  private near(p: IndexedRef, radiusM: number): number[] {
    const c = this.chains.get(p.chain);
    if (!c) return [];
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return [];
    const dLat = radiusM / M_PER_DEG;
    const cosLat = Math.cos(rad(Math.min(89.9, Math.abs(p.lat) + dLat)));
    const dLng = dLat / Math.max(cosLat, 1e-6);
    const y0 = latCell(p.lat - dLat), y1 = latCell(p.lat + dLat);
    const x0 = Math.floor((p.lng - dLng) / CELL_DEG), x1 = Math.floor((p.lng + dLng) / CELL_DEG);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_SCAN_CELLS) return c.all;
    const out: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const cx = ((x % LNG_CELLS) + LNG_CELLS) % LNG_CELLS;
      for (let y = y0; y <= y1; y++) {
        const cell = c.cells.get(cellKey(cx, y));
        if (cell) out.push(...cell);
      }
    }
    return out.sort((a, b) => a - b);
  }

  /** Те же точки, что нашёл бы `samePlace(p, refs, radiusM)`: ближе radiusM или та же улица в 5 км. */
  has(p: IndexedRef, radiusM = MATCH_RADIUS_M): boolean {
    for (const i of this.near(p, radiusM)) {
      if (distanceM(this.refs[i], p) <= radiusM) return true;
    }
    const key = streetKey(p.address);
    if (key === null) return false;
    const same = this.chains.get(p.chain)?.streets.get(key);
    return !!same?.some((i) => distanceM(this.refs[i], p) <= SAME_ADDRESS_RADIUS_M);
  }

  /** Индексы опорных точек ближе radiusM (по возрастанию). */
  within(p: IndexedRef, radiusM: number): Array<{ i: number; d: number }> {
    const out: Array<{ i: number; d: number }> = [];
    for (const i of this.near(p, radiusM)) {
      const d = distanceM(this.refs[i], p);
      if (d <= radiusM) out.push({ i, d });
    }
    return out;
  }
}

/** Пара — та же сеть и ближе radiusM. Жадно по возрастанию расстояния: одна точка базы
 *  сопоставляется не больше одного раза, иначе два соседних McDonald's слиплись бы в один.
 *  Кандидаты ищутся по сетке; порядок пар (расстояние, затем порядок existing и found) тот же,
 *  что у полного перебора. */
export function matchPoints<
  E extends { id: string; chain: string } & GeoPoint,
  P extends { chain: string } & GeoPoint,
>(existing: E[], found: P[], radiusM = MATCH_RADIUS_M): MatchResult<E, P> {
  const pairs: Array<{ e: number; f: number; d: number }> = [];
  const index = new PlaceIndex(found);
  existing.forEach((e, ei) => {
    for (const { i: fi, d } of index.within(e, radiusM)) pairs.push({ e: ei, f: fi, d });
  });
  pairs.sort((a, b) => a.d - b.d || a.e - b.e || a.f - b.f);
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

/** Та же точка той же сети: ближе radiusM — или тот же адрес (улица и дом) в пределах 5 км. */
export function samePlace(
  p: { chain: string; address?: string | null } & GeoPoint,
  refs: Array<{ chain: string; address?: string | null } & GeoPoint>,
  radiusM = MATCH_RADIUS_M,
): boolean {
  const key = streetKey(p.address);
  return refs.some((r) => {
    if (r.chain !== p.chain) return false;
    const d = distanceM(r, p);
    return d <= radiusM || (key !== null && d <= SAME_ADDRESS_RADIUS_M && streetKey(r.address) === key);
  });
}

/** Один объект, нанесённый на карту дважды (узел и здание): точка без адреса в пределах radiusM от точки
 *  той же сети, которая осталась, — двойник. Остаётся точка с адресом; без адреса у обеих — первая. Две точки
 *  с адресами сюда не попадают: это может быть соседний магазин, их различает samePlace. */
export const ADDRESSLESS_TWIN_M = 35;
export function dropAddresslessTwins<P extends { chain: string; address?: string | null } & GeoPoint>(
  points: P[],
  radiusM = ADDRESSLESS_TWIN_M,
): P[] {
  const addressed = points.filter((p) => !!p.address?.trim());
  const index = new PlaceIndex(addressed);
  const keptBare: P[] = [];
  const dropped = new Set<P>();
  for (const p of points) {
    if (p.address?.trim()) continue;
    // p без адреса: samePlace и PlaceIndex.has сводятся к «та же сеть и ближе radiusM».
    if (index.has(p, radiusM) || samePlace(p, keptBare, radiusM)) dropped.add(p);
    else keptBare.push(p);
  }
  return points.filter((p) => !dropped.has(p));
}
