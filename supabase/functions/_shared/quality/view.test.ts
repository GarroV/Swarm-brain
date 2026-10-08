// Сборка ответа GET /quality из строк базы. Данные синтетические.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildQualityView, type StoredScore } from "./view.ts";

const row = (unit: string, name: string, cc: string, start: string, score: number | string): StoredScore => ({
  unit_id: unit,
  unit_name: name,
  country_code: cc,
  developer: "Dev",
  period_start: start,
  period_end: start.replace(/-01$/, "-15"),
  score,
});

Deno.test("scores line up with ascending periods, gaps are null, latest name wins", () => {
  const v = buildQualityView("rs", [
    row("b", "Zeta-1", "RS", "2026-02-01", "91.50"),
    row("a", "Old name", "BG", "2026-01-01", 80),
    row("a", "Alpha-1", "BG", "2026-02-01", 82),
  ]);
  assertEquals(v.periods, [{ start: "2026-01-01", end: "2026-01-15" }, { start: "2026-02-01", end: "2026-02-15" }]);
  assertEquals(v.units, [
    { id: "a", name: "Alpha-1", cc: "BG", developer: "Dev", scores: [80, 82] },
    { id: "b", name: "Zeta-1", cc: "RS", developer: "Dev", scores: [null, 91.5] },
  ]);
});

Deno.test("no rows — empty periods and units", () => {
  assertEquals(buildQualityView("rko", []), { kind: "rko", periods: [], units: [] });
});
