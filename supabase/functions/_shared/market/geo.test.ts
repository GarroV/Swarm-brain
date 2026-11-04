import { assertEquals } from "@std/assert";
import { distanceM, MATCH_RADIUS_M, matchPoints, PlaceIndex, samePlace } from "./geo.ts";

const ref = {
  chain: "dominos",
  lat: 45.80,
  lng: 15.97,
  address: "Ulica kneza Mislava 1, 10000 Zagreb (opposite Hotel Sheraton)",
};

Deno.test("samePlace: near point of the chain, or the same street and number a few km off; a neighbour number is not", () => {
  const at = (lat: number, address: string | null, chain = "dominos") => ({ chain, lat, lng: 15.97, address });
  assertEquals([
    samePlace(at(45.8005, null), [ref]),
    samePlace(at(45.81, "Ulica kneza Mislava 1"), [ref]),
    samePlace(at(45.81, "Kneza Mislava 3"), [ref]),
    samePlace(at(45.81, "Ulica kneza Mislava 1", "kfc"), [ref]),
    samePlace(at(45.99, "Ulica kneza Mislava 1"), [ref]),
  ], [true, true, false, false, false]);
  const bk = { chain: "bk", lat: 45.80, lng: 16.20, address: "Ul. Alfreda Nobela 10, Sop, 10361 Sesvetski Kraljevec" };
  assertEquals(samePlace({ chain: "bk", lat: 45.82, lng: 16.20, address: "Ulica Alfreda Nobela 10" }, [bk]), true);
});

// Эталон — прежний перебор «каждая с каждой»: индекс по сетке обязан давать тот же результат.
const bruteMatch = <
  E extends { id: string; chain: string } & { lat: number; lng: number },
  P extends { chain: string; lat: number; lng: number },
>(
  existing: E[],
  found: P[],
  radiusM = MATCH_RADIUS_M,
) => {
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
  const matched: Array<[string, number]> = [];
  for (const p of pairs) {
    if (usedE.has(p.e) || usedF.has(p.f)) continue;
    usedE.add(p.e);
    usedF.add(p.f);
    matched.push([existing[p.e].id, p.f]);
  }
  return {
    matched,
    unmatched: found.map((_, i) => i).filter((i) => !usedF.has(i)),
    missing: existing.filter((_, i) => !usedE.has(i)).map((e) => e.id),
  };
};
const bruteSame = (
  p: { chain: string; address?: string | null; lat: number; lng: number },
  refs: Array<{ chain: string; address?: string | null; lat: number; lng: number }>,
) => samePlace(p, refs);

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

Deno.test("PlaceIndex and matchPoints equal the full scan, incl. cell borders, antimeridian, high latitude", () => {
  const rnd = rng(7);
  const streets = ["Calle Mayor 1", "Calle Mayor 2", "Ulica Dugi 5", null];
  // Центры: на границе ячеек сетки, у антимеридиана, у полюса, обычные.
  const centres = [[45.8, 15.97], [40.01, -3.0], [0, 0], [-16.5, 179.995], [64.0, -179.99], [78.2, 15.6], [0.0, 180]];
  for (const [clat, clng] of centres) {
    const mk = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => {
        // 0.0013° ≈ 145 м — вокруг радиуса сопоставления; часть точек ровно на границе ячейки.
        const snap = rnd() < 0.3;
        const lat = clat + (snap ? 0 : (rnd() - 0.5) * 0.02) +
          (snap ? Math.round((rnd() - 0.5) * 2) * 0.01 + (rnd() - 0.5) * 0.0027 : 0);
        const lng = clng + (rnd() - 0.5) * 0.03;
        return {
          id: `${tag}${i}`,
          chain: rnd() < 0.5 ? "a" : "b",
          lat: Math.max(-90, Math.min(90, lat)),
          lng: lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng,
          address: streets[Math.floor(rnd() * streets.length)],
        };
      });
    const existing = mk(120, "e"), found = mk(120, "f");
    const want = bruteMatch(existing, found);
    const got = matchPoints(existing, found);
    assertEquals(got.matched.map((m) => [m.existing.id, found.indexOf(m.found)]), want.matched);
    assertEquals(got.unmatched.map((f) => found.indexOf(f)), want.unmatched);
    assertEquals(got.missing.map((e) => e.id), want.missing);
    const idx = new PlaceIndex(existing);
    for (const f of found) assertEquals(idx.has(f), bruteSame(f, existing));
  }
});

Deno.test("PlaceIndex: same street within 5 km found though outside the grid neighbourhood", () => {
  const far = { chain: "a", lat: 45.80, lng: 15.97, address: "Kneza Mislava 1" };
  const idx = new PlaceIndex([far]);
  assertEquals(idx.has({ chain: "a", lat: 45.84, lng: 15.97, address: "Ulica kneza Mislava 1" }), true);
  assertEquals(idx.has({ chain: "a", lat: 45.84, lng: 15.97, address: "Kneza Mislava 3" }), false);
  assertEquals(idx.has({ chain: "a", lat: Number.NaN, lng: 15.97, address: null }), false);
});
