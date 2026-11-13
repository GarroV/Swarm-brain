import { assert, assertEquals } from "@std/assert";
import { mirrorCountry, parseCountryFilter, parseTaskCountries, taskCountriesText, toIsoCode } from "./countries.ts";

const ok = (input: unknown) => {
  const r = parseTaskCountries(input);
  assert(r.ok, JSON.stringify(r));
  return r.countries;
};

Deno.test("parseTaskCountries: коды, имена RU/EN и регистр приводятся к ISO-2", () => {
  assertEquals(ok(["hu", "Сербия", "Belarus"]), ["HU", "RS", "BY"]);
  assertEquals(ok("Словения"), ["SI"]);
  assertEquals(ok("United Arab Emirates"), ["AE"]);
});

Deno.test("parseTaskCountries: старая составная строка «RS, HU» разбирается по разделителям", () => {
  assertEquals(ok("RS, HU"), ["RS", "HU"]);
  assertEquals(ok("RS/HR;ME"), ["RS", "HR", "ME"]);
});

Deno.test("parseTaskCountries: коды вне словаря рынков (PT, NL) допустимы, порядок и уникальность держатся", () => {
  assertEquals(ok(["PT", "NL", "pt", "RS"]), ["PT", "NL", "RS"]);
});

Deno.test("parseTaskCountries: пусто = без страны", () => {
  for (const empty of [null, undefined, "", [], [" "]]) assertEquals(ok(empty), []);
});

Deno.test("parseTaskCountries: неизвестное значение — ошибка с самим значением, а не тихий пропуск", () => {
  for (const bad of [["HU", "Атлантида"], "ZZ", ["EU"], ["HUN"], "RS, Narnia"]) {
    const r = parseTaskCountries(bad);
    assert(!r.ok, JSON.stringify(bad));
    assert(r.error.includes("Неизвестная страна"), r.error);
  }
  assert(!parseTaskCountries([1]).ok);
  assert(!parseTaskCountries({}).ok);
  assert(!parseTaskCountries(Array.from({ length: 40 }, (_, i) => `A${String.fromCharCode(65 + (i % 26))}`)).ok);
});

Deno.test("parseCountryFilter / toIsoCode / mirrorCountry / taskCountriesText", () => {
  const f = parseCountryFilter("HU,RS");
  assert(f.ok);
  assertEquals(f.countries, ["HU", "RS"]);
  assertEquals(toIsoCode(" rs "), "RS");
  assertEquals(toIsoCode("мусор"), null);
  assertEquals(mirrorCountry(["RS", "HU"]), "RS");
  assertEquals(mirrorCountry([]), null);
  assertEquals(taskCountriesText({ countries: ["HU", "RS"] }), "HU · RS");
  assertEquals(taskCountriesText({ countries: [], country: "Bulgaria" }), "Bulgaria");
  assertEquals(taskCountriesText({}), "");
});
