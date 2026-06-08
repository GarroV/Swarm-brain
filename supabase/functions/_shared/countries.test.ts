import { assertEquals } from "jsr:@std/assert@1";
import { normalizeCountry, normalizeCountries } from "./countries.ts";

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
