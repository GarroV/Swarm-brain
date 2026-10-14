import { assertEquals } from "jsr:@std/assert@1";
import type { MapsData, MapsUnit } from "./api.ts";
import { countryMaps, mapsByUnit, unitChange } from "./homeMaps.ts";

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
