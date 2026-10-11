import { assertEquals } from "jsr:@std/assert@1";
import type { MapsData } from "./api.ts";
import { mapsCountries } from "./homeMaps.ts";

Deno.test("mapsCountries: порядок выбора, страны без строки пропускаются", () => {
  const c = (cc: string) => ({ cc } as MapsData["countries"][number]);
  const data = { countries: [c("RS"), c("HR")] } as MapsData;
  assertEquals(mapsCountries(data, ["HR", "XX", "RS"]).map((x) => x.cc), ["HR", "RS"]);
});
