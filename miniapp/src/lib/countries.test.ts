import { assertEquals } from "jsr:@std/assert@1";
import { countriesLabel, countriesPatch, parseCountryList, taskCountryCodes, toggleCountry } from "./countries.ts";

Deno.test("countriesLabel: коды через « · », больше трёх — «HU · RS +2»", () => {
  assertEquals(countriesLabel([]), "");
  assertEquals(countriesLabel(["HU"]), "HU");
  assertEquals(countriesLabel(["HU", "RS", "ME"]), "HU · RS · ME");
  assertEquals(countriesLabel(["HU", "RS", "ME", "PT"]), "HU · RS +2");
  assertEquals(countriesLabel(["HU", "RS", "ME", "PT", "NL", "ES"]), "HU · RS +4");
});

Deno.test("taskCountryCodes: список важнее старого country; пустой список — «без страны»", () => {
  assertEquals(taskCountryCodes({ countries: ["HU", "RS"], country: "HU" }), ["HU", "RS"]);
  assertEquals(taskCountryCodes({ countries: [], country: "EU" }), []);
  // Строка до раскатки колонки: читается по country, имена приводятся к кодам.
  assertEquals(taskCountryCodes({ country: "Словения" }), ["SI"]);
  assertEquals(taskCountryCodes({ country: "RS, HU" }), ["RS", "HU"]);
  assertEquals(taskCountryCodes({ country: null }), []);
});

Deno.test("parseCountryList / toggleCountry / countriesPatch", () => {
  assertEquals(parseCountryList("RS,HU; rs"), ["RS", "HU"]);
  assertEquals(parseCountryList("—"), []);
  assertEquals(toggleCountry(["HU"], "RS"), ["HU", "RS"]);
  assertEquals(toggleCountry(["HU", "RS"], "hu"), ["RS"]);
  assertEquals(countriesPatch(["RS", "HU"]), { countries: ["RS", "HU"], country: "RS" });
  assertEquals(countriesPatch([]), { countries: [], country: null });
});
