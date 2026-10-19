import { assertEquals } from "jsr:@std/assert@1";
import type { MapsCountry, MapsData, MapsUnit } from "./api.ts";
import { countryMaps, mapsByUnit, mapsSummary, unitChange, weightedMaps } from "./homeMaps.ts";

const unit = (id: string, google: MapsUnit["maps"]["google"]): MapsUnit => ({
  id, name: "Dodo Pizza", cc: "RS", city: null, maps: { google, yandex: null },
});

Deno.test("mapsByUnit: ключ — id в нижнем регистре (как Pizzeria.key), не название с карт", () => {
  const data = { units: [unit("ABCD", { avg: 4.5, reviews: 10, prev_avg: 4.4 })] } as MapsData;
  const m = mapsByUnit(data);
  assertEquals(m.get("abcd")?.google?.avg, 4.5);
  assertEquals(m.has("Dodo Pizza"), false);
  assertEquals(mapsByUnit(null).size, 0);
});

Deno.test("unitChange: оценка − прошлая, округление до сотых; без прошлой или без оценки — null", () => {
  assertEquals(unitChange({ avg: 4.55, reviews: 1, prev_avg: 4.4 }), 0.15);
  assertEquals(unitChange({ avg: 4.3, reviews: 1, prev_avg: 4.4 }), -0.1);
  assertEquals(unitChange({ avg: 4.3, reviews: 1, prev_avg: null }), null);
  assertEquals(unitChange({ avg: null, reviews: 0, prev_avg: 4 }), null);
  assertEquals(unitChange(null), null);
});

Deno.test("countryMaps: строка страны или null", () => {
  const data = { countries: [{ cc: "RS" }] } as MapsData;
  assertEquals(countryMaps(data, "RS")?.cc, "RS");
  assertEquals(countryMaps(data, "HR"), null);
  assertEquals(countryMaps(null, "RS"), null);
});

const stat = (avg: number | null, reviews: number, delta: number | null = null) => ({ avg, reviews, branches: 1, delta });
const country = (cc: string, google: ReturnType<typeof stat>, yandex = stat(null, 0)): MapsCountry => ({ cc, as_of: null, maps: { google, yandex } });

Deno.test("weightedMaps: среднее и изменение взвешены отзывами, страны без оценки не тянут к нулю", () => {
  const t = weightedMaps([country("RS", stat(4, 100, 0.1)), country("HR", stat(5, 300, -0.2)), country("BA", stat(null, 0))], "google");
  assertEquals(t, { avg: 4.75, delta: -0.12, reviews: 400 });
  assertEquals(weightedMaps([country("BA", stat(null, 0))], "yandex"), { avg: null, delta: null, reviews: 0 });
  assertEquals(weightedMaps([], "google").avg, null);
});

Deno.test("mapsSummary: только выбранные страны; ниже 4.5, без отзывов, Яндекс скрывается без данных", () => {
  const data = {
    countries: [country("RS", stat(4.6, 100)), country("HR", stat(4.2, 100), stat(4.5, 10)), country("XX", stat(1, 1))],
    units: [
      { ...unit("a", { avg: 4.6, reviews: 5, prev_avg: null }), cc: "RS" },
      { ...unit("b", { avg: 4.1, reviews: 5, prev_avg: null }), cc: "HR" },
      { ...unit("c", { avg: 3.9, reviews: 5, prev_avg: null }), cc: "RS" },
      { ...unit("d", null), cc: "HR" },
      { ...unit("e", { avg: null, reviews: 0, prev_avg: null }), cc: "RS" },
      { ...unit("f", { avg: 2, reviews: 5, prev_avg: null }), cc: "XX" },
    ],
  } as MapsData;
  const all = mapsSummary(data, ["RS", "HR"]);
  assertEquals(all.rows.map((c) => c.cc), ["RS", "HR"]);
  assertEquals(all.low.map((u) => u.id), ["c", "b"]); // худшие первыми, XX не считается
  assertEquals(all.noReviews.map((u) => u.id), ["d", "e"]);
  assertEquals(all.google.avg, 4.4);
  // IMF — все страны ответа, включая невыбранную XX (1 отзыв с оценкой 1): (460 + 420 + 1) / 201
  assertEquals(all.imf.google.avg, 4.38);
  assertEquals(mapsSummary(data, ["RS"]).imf.google.avg, 4.38); // IMF от выбора не зависит
  assertEquals(mapsSummary(data, ["RS"]).google.avg, 4.6);
  assertEquals(all.hasYandex, true);
  assertEquals(mapsSummary(data, ["RS"]).hasYandex, false);
});
