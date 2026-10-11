import { assertEquals } from "jsr:@std/assert@1";
import type { MapsData, MapsUnit } from "./api.ts";
import { mapsCountries, worstUnits } from "./homeMaps.ts";

const unit = (name: string, cc: string, g: [number, number, number | null] | null): MapsUnit => ({
  id: name, name, cc, city: null,
  maps: { google: g ? { avg: g[0], reviews: g[1], prev_avg: g[2] } : null, yandex: null },
});

Deno.test("worstUnits: худшие сверху, без оценки и чужих стран нет, изменение = оценка − прошлая", () => {
  const units = [
    unit("A", "RS", [4.5, 10, 4.7]), unit("B", "RS", [3.2, 5, null]), unit("C", "HR", [1, 9, 1]),
    unit("D", "RS", null), unit("E", "RS", [3.2, 50, 3.0]), unit("F", "RS", [4.9, 1, 4.9]),
  ];
  const w = worstUnits(units, ["RS"], 3);
  assertEquals(w.map((x) => x.name), ["E", "B", "A"]);
  assertEquals(w.map((x) => x.change), [0.2, null, -0.2]);
});

Deno.test("mapsCountries: порядок выбора, страны без строки пропускаются", () => {
  const c = (cc: string) => ({ cc } as MapsData["countries"][number]);
  const data = { countries: [c("RS"), c("HR")] } as MapsData;
  assertEquals(mapsCountries(data, ["HR", "XX", "RS"]).map((x) => x.cc), ["HR", "RS"]);
});
