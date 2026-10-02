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
