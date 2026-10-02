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

/** Пара — та же сеть и ближе radiusM. Жадно по возрастанию расстояния: одна точка базы
 *  сопоставляется не больше одного раза, иначе два соседних McDonald's слиплись бы в один. */
export function matchPoints<
  E extends { id: string; chain: string } & GeoPoint,
  P extends { chain: string } & GeoPoint,
>(existing: E[], found: P[], radiusM = MATCH_RADIUS_M): MatchResult<E, P> {
  const pairs: Array<{ e: number; f: number; d: number }> = [];
  existing.forEach((e, ei) =>
    found.forEach((f, fi) => {
      if (e.chain !== f.chain) return;
      const d = distanceM(e, f);
      if (d <= radiusM) pairs.push({ e: ei, f: fi, d });
    })
  );
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
