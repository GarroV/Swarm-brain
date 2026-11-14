import { assertEquals, assertThrows } from "@std/assert";
import { createDictionaryRuntime, legacyTranslation } from "./runtime.ts";
import { validateCatalog } from "./validation.mjs";

const catalog = {
  en: { title: "Hello", greeting: "Hello {{name}}", item_one: "{{count}} item for {{name}}", item_other: "{{count}} items for {{name}}" },
  ru: { title: "Привет", greeting: "Привет {{name}}", item_one: "{{count}} штука для {{name}}", item_few: "{{count}} штуки для {{name}}", item_many: "{{count}} штук для {{name}}", item_other: "{{count}} штуки для {{name}}" },
  sr: { title: "Zdravo", greeting: "Zdravo {{name}}", item_one: "{{count}} stavka za {{name}}", item_few: "{{count}} stavke za {{name}}", item_other: "{{count}} stavki za {{name}}" },
} as const;

Deno.test("dictionary translators are stable, independent and use regional/English fallback", () => {
  const get = createDictionaryRuntime(catalog), ru = get("ru"), en = get("en"), sr = get("sr");
  assertEquals(ru("title"), "Привет"); assertEquals(en("title"), "Hello"); assertEquals(sr("title"), "Zdravo");
  assertEquals(get("RU-ru") === ru, true); assertEquals(get("sr-Latn-RS") === sr, true);
  assertEquals(get("xx-XX") === en, true); assertEquals(get("en") === en, true);
  assertEquals(ru("title"), "Привет");
});

Deno.test("plural rules select real EN/RU/SR forms, including decimals and zero", () => {
  const get = createDictionaryRuntime(catalog);
  for (const [count, expected] of [[0, "штук"], [1, "штука"], [2, "штуки"], [5, "штук"], [21, "штука"], [1.5, "штуки"]] as const) {
    assertEquals(get("ru")("item", { count, name: "A" }), `${count} ${expected} для A`);
  }
  assertEquals(get("en")("item", { count: 1, name: "A" }), "1 item for A");
  assertEquals(get("en")("item", { count: 2, name: "A" }), "2 items for A");
  assertEquals(get("sr")("item", { count: 2, name: "A" }), "2 stavke za A");
});

Deno.test("user values stay literal, with no HTML escaping or nested interpolation", () => {
  const t = createDictionaryRuntime(catalog)("en");
  const name = '<b>$& {{title}}</b>';
  assertEquals(t("greeting", { name }), `Hello ${name}`);
});

Deno.test("unknown keys, missing/extra parameters and invalid counts fail visibly", () => {
  const t = createDictionaryRuntime(catalog)("en") as (key: string, values?: Record<string, unknown>) => string;
  for (const invoke of [
    () => t("unknown"), () => t("greeting"), () => t("title", { name: "A" }),
    () => t("greeting", { name: {} }), () => t("item", { count: "2", name: "A" }),
    () => t("item", { count: Infinity, name: "A" }), () => t("item", { count: NaN, name: "A" }),
    () => t("greeting", { name: "A", lng: "ru" }),
  ]) assertThrows(invoke, Error, "i18n:");
});

Deno.test("incomplete catalogs, placeholders and plural forms are rejected", () => {
  const broken: unknown[] = [
    {}, { en: {} }, { en: { title: "Hello" }, ru: {} },
    { en: { title: "Hello" }, ru: { title: "" } },
    { en: { greeting: "Hello {{name}}" }, ru: { greeting: "Привет {{person}}" } },
    { en: { greeting: "Hello {{name" } },
    { en: { title: "Literal $t(other.title)" } },
    { en: { item_one: "one", item_other: "many" }, ru: { item_one: "один", item_other: "много" } },
    { en: { item: "one", item_other: "many" } },
    { en: { item_one: "{{name}} one", item_other: "many" } },
    { en: { item_one: "one", item_few: "few", item_other: "many" } },
  ];
  for (const value of broken) assertThrows(() => validateCatalog(value), Error, "i18n:");
});

Deno.test("compatibility preserves exact old language and user-text semantics", () => {
  const ru = "Привет $& {{name}}", en = "Hello $& {{name}}";
  assertEquals(legacyTranslation("ru", ru, en), ru);
  assertEquals(legacyTranslation("en", ru, en), en);
  assertEquals(legacyTranslation("unknown", ru, en), ru);
});
