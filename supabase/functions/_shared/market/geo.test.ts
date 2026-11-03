import { assertEquals } from "@std/assert";
import { distanceM, MATCH_RADIUS_M, matchPoints, placeMatcher, samePlace } from "./geo.ts";

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

Deno.test("matchPoints and samePlace via the grid give the same answer as a brute-force scan", () => {
  // Детерминированный разброс на пятачке ~3 км, чтобы пар было много и они лежали на границах ячеек.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pt = (i: number) => ({
    id: String(i),
    chain: i % 3 === 0 ? "a" : "b",
    lat: 40 + rnd() * 0.03,
    lng: 10 + rnd() * 0.03,
    address: null,
  });
  const existing = Array.from({ length: 300 }, (_, i) => pt(i));
  const found = Array.from({ length: 300 }, (_, i) => pt(i + 1000));
  const brute: Array<{ e: number; f: number; d: number }> = [];
  existing.forEach((e, ei) =>
    found.forEach((f, fi) => {
      const d = distanceM(e, f);
      if (e.chain === f.chain && d <= MATCH_RADIUS_M) brute.push({ e: ei, f: fi, d });
    })
  );
  brute.sort((x, y) => x.d - y.d);
  const usedE = new Set<number>(), usedF = new Set<number>(), want: string[] = [];
  for (const p of brute) {
    if (usedE.has(p.e) || usedF.has(p.f)) continue;
    usedE.add(p.e);
    usedF.add(p.f);
    want.push(`${existing[p.e].id}-${found[p.f].id}`);
  }
  const got = matchPoints(existing, found).matched.map((m) => `${m.existing.id}-${m.found.id}`);
  assertEquals(got, want);
  assertEquals(want.length > 20, true);
  const near = placeMatcher(existing);
  const wantNear = found.map((f) => existing.some((e) => e.chain === f.chain && distanceM(e, f) <= MATCH_RADIUS_M));
  assertEquals(found.map((f) => near(f)), wantNear);
});
