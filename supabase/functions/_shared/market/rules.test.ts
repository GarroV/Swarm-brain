import { assert, assertEquals } from "@std/assert";
import { distanceM, matchPoints } from "./geo.ts";
import { canSeeCountry, foldDailyOrders, shouldFlagClosed, toEur } from "./rules.ts";

Deno.test("distanceM: 0.001° of latitude is ~111 m", () => {
  const d = distanceM({ lat: 45.8, lng: 15.97 }, { lat: 45.801, lng: 15.97 });
  assert(d > 105 && d < 117, String(d));
});

Deno.test("matchPoints pairs same chain within 150 m, never across chains", () => {
  const existing = [{ id: "a", chain: "kfc", lat: 45.8, lng: 15.97 }, { id: "b", chain: "mcd", lat: 45.9, lng: 16.0 }];
  const found = [{ chain: "kfc", lat: 45.8009, lng: 15.97 }, { chain: "kfc", lat: 45.9, lng: 16.0 }];
  const r = matchPoints(existing, found);
  assertEquals(r.matched.map((m) => m.existing.id), ["a"]);
  assertEquals(r.unmatched.length, 1);
  assertEquals(r.missing.map((e) => e.id), ["b"]);
});

Deno.test("matchPoints: one existing point is matched once", () => {
  const existing = [{ id: "a", chain: "kfc", lat: 45.8, lng: 15.97 }];
  const found = [{ chain: "kfc", lat: 45.8, lng: 15.97 }, { chain: "kfc", lat: 45.8001, lng: 15.97 }];
  const r = matchPoints(existing, found);
  assertEquals(r.matched.length, 1);
  assertEquals(r.unmatched.length, 1);
});

Deno.test("shouldFlagClosed: only osm-sourced, untrusted, 3+ weeks", () => {
  assert(shouldFlagClosed({ verification: "unverified", source_kind: "osm", missing_weeks: 3 }));
  assert(!shouldFlagClosed({ verification: "unverified", source_kind: "osm", missing_weeks: 2 }));
  assert(!shouldFlagClosed({ verification: "official", source_kind: "osm", missing_weeks: 9 }));
  assert(!shouldFlagClosed({ verification: "unverified", source_kind: "snapshot", missing_weeks: 9 }));
});

Deno.test("foldDailyOrders sums by month and marks the current month incomplete", () => {
  const r = foldDailyOrders([
    { date: "2026-09-29", counts: { aggregator: 2, restaurant: 1 } },
    { date: "2026-09-30", counts: { aggregator: 3 } },
    { date: "2026-10-01", counts: { site: 1 } },
  ], "2026-10-02");
  assertEquals(r, [
    { month: "2026-09", orders: { aggregator: 5, restaurant: 1 }, complete: true },
    { month: "2026-10", orders: { site: 1 }, complete: false },
  ]);
});

Deno.test("toEur divides by units-per-euro; EUR passes through; unknown → null", () => {
  assertEquals(toEur(497, "RON", { RON: 4.97 }), 100);
  assertEquals(toEur(10, "EUR", {}), 10);
  assertEquals(toEur(10, "XYZ", {}), null);
});

Deno.test("canSeeCountry: demo sees only XD, real workspace never XD", () => {
  assert(canSeeCountry("XD", null, true));
  assert(!canSeeCountry("HR", ["HR"], true));
  assert(canSeeCountry("HR", ["HR", "RO"], false));
  assert(!canSeeCountry("XD", ["XD"], false));
  assert(!canSeeCountry("EE", null, false));
  assert(canSeeCountry("hr", ["HR"], false));
});
