import { assertEquals } from "@std/assert";
import { type FilledSections, isCountryReady, readyCountries } from "./readiness.ts";

const NOW = new Date("2026-10-10T00:00:00Z");
const src = (adapter: string, mode: string, last_ok_at: string | null) => ({ adapter, mode, last_ok_at });
const FULL: FilledSections = { editorial: true, prices: true, facts: true, financials: true };
const run = (source: string, status: string, finished_at: string) => ({ source, status, finished_at });

Deno.test("ready: every auto source is fresh and the last run is ok", () => {
  assertEquals(
    isCountryReady([src("osm", "auto", "2026-10-05T00:00:00Z")], [run("osm", "ok", "2026-10-05T00:00:00Z")], FULL, NOW),
    true,
  );
});

Deno.test("not ready: a country with no auto source (manual only, or no sources at all)", () => {
  assertEquals(isCountryReady([src("m", "manual", "2026-10-09T00:00:00Z")], [], FULL, NOW), false);
  assertEquals(isCountryReady([], [], FULL, NOW), false);
});

Deno.test("not ready: one bad auto source spoils the country, manual sources do not count", () => {
  const fresh = src("osm", "auto", "2026-10-05T00:00:00Z");
  assertEquals(isCountryReady([fresh, src("old", "auto", "2026-09-30T00:00:00Z")], [], FULL, NOW), false); // 10 days
  assertEquals(isCountryReady([fresh, src("never", "auto", null)], [], FULL, NOW), false);
  assertEquals(
    isCountryReady(
      [fresh, run("osm", "failed", "2026-10-09T00:00:00Z") && src("m", "manual", null)],
      [
        run("osm", "failed", "2026-10-09T00:00:00Z"),
      ],
      FULL,
      NOW,
    ),
    false,
  );
  assertEquals(
    isCountryReady([fresh, src("m", "manual", null)], [run("osm", "ok", "2026-10-05T00:00:00Z")], FULL, NOW),
    true,
  );
});

Deno.test("an older failed run does not count once a later run succeeded; exactly 8 days is still fresh", () => {
  const runs = [run("osm", "failed", "2026-10-01T00:00:00Z"), run("osm", "ok", "2026-10-08T00:00:00Z")];
  assertEquals(isCountryReady([src("osm", "auto", "2026-10-02T00:00:00Z")], runs, FULL, NOW), true);
  assertEquals(isCountryReady([src("osm", "auto", "2026-10-01T00:00:00Z")], [], FULL, NOW), false);
});

Deno.test("readyCountries splits rows by country", () => {
  const sources = [
    { country: "HR", ...src("osm", "auto", "2026-10-05T00:00:00Z") },
    { country: "RS", ...src("osm", "auto", "2026-10-05T00:00:00Z") },
    { country: "XX", ...src("m", "manual", null) },
  ];
  const runs = [{ country: "RS", ...run("osm", "failed", "2026-10-09T00:00:00Z") }];
  assertEquals(readyCountries(["HR", "RS", "XX", "ZZ"], sources, runs, { HR: FULL, RS: FULL, XX: FULL }, NOW), ["HR"]);
});

Deno.test("not ready: fresh auto source but any section empty (BG-like: no editorial, prices, facts)", () => {
  const fresh = [src("dodo", "auto", "2026-10-09T00:00:00Z")];
  assertEquals(
    isCountryReady(fresh, [], { editorial: false, prices: false, facts: false, financials: true }, NOW),
    false,
  );
  for (const k of Object.keys(FULL) as Array<keyof FilledSections>) {
    assertEquals(isCountryReady(fresh, [], { ...FULL, [k]: false }, NOW), false, k);
  }
  assertEquals(isCountryReady(fresh, [], FULL, NOW), true); // HR-like
});

Deno.test("not ready: all sections filled but an auto source is stale", () => {
  assertEquals(isCountryReady([src("osm", "auto", "2026-09-20T00:00:00Z")], [], FULL, NOW), false);
});
