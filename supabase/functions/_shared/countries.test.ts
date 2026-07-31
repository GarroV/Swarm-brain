import { assertEquals } from "jsr:@std/assert@1";
import { normalizeCountry, normalizeCountries, detectQueryCountry } from "./countries.ts";

Deno.test("normalizeCountry — passes through valid ISO code uppercased", () => {
  assertEquals(normalizeCountry("RS"), "RS");
  assertEquals(normalizeCountry("rs"), "RS");
  assertEquals(normalizeCountry("  kz  "), "KZ");
});

Deno.test("normalizeCountry — resolves Russian alias", () => {
  assertEquals(normalizeCountry("Сербия"), "RS");
  assertEquals(normalizeCountry("сербия"), "RS");
  assertEquals(normalizeCountry("Казахстан"), "KZ");
});

Deno.test("normalizeCountry — resolves English alias", () => {
  assertEquals(normalizeCountry("Serbia"), "RS");
  assertEquals(normalizeCountry("poland"), "PL");
});

Deno.test("normalizeCountry — handles legacy parenthesized alias", () => {
  assertEquals(normalizeCountry("(Испания)"), "ES");
});

Deno.test("normalizeCountry — returns null for unknown", () => {
  assertEquals(normalizeCountry("Atlantis"), null);
  assertEquals(normalizeCountry(""), null);
  assertEquals(normalizeCountry("XX"), null);
});

Deno.test("normalizeCountries — dedupes and drops unknowns", () => {
  assertEquals(
    normalizeCountries(["Сербия", "RS", "serbia", "Atlantis", "Польша"]),
    ["RS", "PL"],
  );
});

Deno.test("normalizeCountries — empty input yields empty array", () => {
  assertEquals(normalizeCountries([]), []);
  assertEquals(normalizeCountries(["", "  ", "nope"]), []);
});

Deno.test("detectQueryCountry — русские склонения детектятся (Сербия→Сербии/Сербией/Сербию)", () => {
  assertEquals(detectQueryCountry("дай последнюю встречу с сербией"), "RS");
  assertEquals(detectQueryCountry("что по сербии"), "RS");
  assertEquals(detectQueryCountry("сербию покажи"), "RS");
  assertEquals(detectQueryCountry("сербия"), "RS");
  assertEquals(detectQueryCountry("по хорватии"), "HR");
  assertEquals(detectQueryCountry("новости черногории"), "ME");
  assertEquals(detectQueryCountry("в молдове"), "MD");
  assertEquals(detectQueryCountry("по литве"), "LT");
});

Deno.test("detectQueryCountry — латиница (в т.ч. прилагательное-префикс)", () => {
  assertEquals(detectQueryCountry("serbian meeting"), "RS");
  assertEquals(detectQueryCountry("spain results"), "ES");
});

Deno.test("detectQueryCountry — НЕ ловит ложные (хвост не падежное окончание)", () => {
  assertEquals(detectQueryCountry("показать индикатор"), null); // не Индия
  assertEquals(detectQueryCountry("надо грузить файл"), null); // не Грузия
  assertEquals(detectQueryCountry("индивидуальный план"), null); // не Индия
  assertEquals(detectQueryCountry("литр воды"), null); // не Литва
  assertEquals(detectQueryCountry("просто рабочая встреча"), null);
});
