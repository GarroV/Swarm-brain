// Модель РС и РКО для главной из ответов GET /quality: средние по странам и подборке, пропуски,
// объединение пиццерий, границы периода. Пиццерии и баллы — выдуманные.
import { assertEquals } from "jsr:@std/assert@1";
import {
  buildQuality, chartBounds, countryOf, latestWeek, latestWave, selectionHistory, selectionMean,
  type QualityInput,
} from "./homeQuality.ts";

const m = (y: number, mo: number) => y * 12 + (mo - 1);
const unit = (id: string, cc: string, name: string, scores: (number | null)[]) => ({ id, cc, name, scores });

const RS: QualityInput = {
  periods: [
    { start: "2026-08-01", end: "2026-08-15" },
    { start: "2026-08-16", end: "2026-08-31" },
    { start: "2026-09-01", end: "2026-09-15" },
    { start: "2026-09-16", end: "2026-09-30" },
  ],
  units: [
    unit("a", "XA", "Alpha-1", [70, 80, 90, 100]),
    unit("b", "XA", "Alpha-2", [null, 60, 70, 80]),
    unit("c", "XB", "Beta-1", [50, 50, 40, null]),
    unit("d", "XB", "Beta-2", [null, null, null, 0]),
  ],
};
const RKO: QualityInput = {
  periods: [
    { start: "2026-09-21", end: "2026-09-27" },
    { start: "2026-09-28", end: "2026-10-04" },
  ],
  units: [
    unit("a", "XA", "Alpha-1", [95, 91]),
    // другой id, но та же страна и то же имя без учёта регистра — та же пиццерия
    unit("zz", "XB", "beta-1", [90, 92]),
    unit("e", "XC", "Gamma-1", [null, 88]),
  ],
};

Deno.test("pizzerias are the union of both kinds by id, falling back to country + name", () => {
  const q = buildQuality(RS, RKO);
  assertEquals(q.countries.map((c) => c.cc), ["XA", "XB", "XC"]);
  const beta = countryOf(q, "XB").pizzerias.find((p) => p.name === "Beta-1")!;
  assertEquals([beta.rko, beta.rkoPrev], [92, 90]);
  assertEquals(countryOf(q, "XB").pizzerias.length, 2);
  const gamma = countryOf(q, "XC").pizzerias[0];
  assertEquals([gamma.rs, gamma.rsPrev, gamma.rsHist, gamma.rko, gamma.rkoPrev], [null, null, [], 88, null]);
});

Deno.test("pizzeria takes the last wave, the one before and up to six earlier scores", () => {
  const a = countryOf(buildQuality(RS, RKO), "XA").pizzerias.find((p) => p.name === "Alpha-1")!;
  assertEquals([a.rs, a.rsPrev, a.rsHist], [100, 90, [70, 80, 90, 100]]);
  const c = countryOf(buildQuality(RS, RKO), "XB").pizzerias.find((p) => p.name === "Beta-1")!;
  assertEquals([c.rs, c.rsPrev, c.rsMissed], [null, 40, true]);
  const d = countryOf(buildQuality(RS, RKO), "XB").pizzerias.find((p) => p.name === "Beta-2")!;
  assertEquals([d.rs, d.rsPrev, d.rsMissed], [0, null, false]);
});

Deno.test("country value is the mean of its pizzerias that have a score", () => {
  const q = buildQuality(RS, RKO);
  const xa = countryOf(q, "XA");
  assertEquals([xa.rs, xa.rsPrev, xa.rko, xa.rkoPrev], [90, 80, 91, 95]);
  const xb = countryOf(q, "XB");
  assertEquals([xb.rs, xb.rsPrev], [0, 40]); // Beta-1 без балла в последней волне не тянет среднее к нулю
  assertEquals(xa.rsHistory.map((p) => p.value), [70, 70, 80, 90]);
  assertEquals(xa.rsHistory[0].date.getDate(), 1);
});

Deno.test("history skips periods without any score", () => {
  const q = buildQuality(RS, RKO);
  const xc = countryOf(q, "XC");
  assertEquals(xc.rsHistory, []);
  assertEquals(xc.rkoHistory.map((p) => p.value), [88]);
});

Deno.test("selection mean is over all pizzerias with a score, not a mean of country means", () => {
  const q = buildQuality(RS, RKO);
  const both = [countryOf(q, "XA"), countryOf(q, "XB")];
  // XA: 100, 80; XB: 0 → (100 + 80 + 0) / 3 = 60, а среднее средних было бы (90 + 0) / 2 = 45
  assertEquals(selectionMean(both, (p) => p.rs), 60);
  assertEquals(selectionMean([countryOf(q, "XC")], (p) => p.rs), null);
  assertEquals(selectionHistory(q, both, "rs").map((p) => p.value), [60, 63.3, 66.7, 60]);
});

Deno.test("country missing from the data is empty, not an error", () => {
  const xz = countryOf(buildQuality(RS, RKO), "XZ");
  assertEquals([xz.rs, xz.rko, xz.pizzerias.length], [null, null, 0]);
});

Deno.test("empty responses give an empty model without bounds", () => {
  const q = buildQuality({ periods: [], units: [] }, { periods: [], units: [] });
  assertEquals(q.countries, []);
  assertEquals(q.rsBounds, null);
  assertEquals(latestWave(q, 0), null);
});

Deno.test("chart bounds run from the first to the last scored month; defaults are clamped to them", () => {
  const q = buildQuality(RS, RKO);
  assertEquals(q.rsBounds, { from: m(2026, 8), to: m(2026, 9) });
  assertEquals(chartBounds(q.rsBounds, 8), { bounds: { from: m(2026, 8), to: m(2026, 9) }, defaults: { from: m(2026, 8), to: m(2026, 9) } });
  const long = { from: m(2024, 1), to: m(2026, 9) };
  assertEquals(chartBounds(long, 8).defaults, { from: m(2026, 2), to: m(2026, 9) });
  assertEquals(chartBounds(long, 2).defaults, { from: m(2026, 8), to: m(2026, 9) });
});

Deno.test("latest wave and week are labelled from the data", () => {
  const q = buildQuality(RS, RKO);
  assertEquals(latestWave(q, 0), { name: "Сентябрь 2", days: "16–30 сентября" });
  assertEquals(latestWave(q, 1), { name: "September 2", days: "Sep 16–30" });
  assertEquals(latestWeek(q), "28.09 — 04.10");
});
