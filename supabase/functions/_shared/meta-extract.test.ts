import { assertEquals } from "jsr:@std/assert@1";
import { applyGeneralSentinel, specificCountries } from "./meta-extract.ts";

// Порог схлопывания 2+ (решение владельца 2026-08-06): ровно 1 рынок → тег; 0 или ≥2 → General.
// См. docs/superpowers/specs/2026-08-06-country-attribution-consolidated.md

Deno.test("applyGeneralSentinel — ровно 1 рынок остаётся тегом", () => {
  assertEquals(applyGeneralSentinel(["RS"]), ["RS"]);
  assertEquals(applyGeneralSentinel(["BG"]), ["BG"]);
});

Deno.test("applyGeneralSentinel — 0 рынков → General", () => {
  assertEquals(applyGeneralSentinel([]), ["General"]);
  assertEquals(applyGeneralSentinel(["General"]), ["General"]);
});

Deno.test("applyGeneralSentinel — ДВА рынка схлопываются в General (новый порог)", () => {
  assertEquals(applyGeneralSentinel(["SI", "RS"]), ["General"]);
  assertEquals(applyGeneralSentinel(["ES", "HU"]), ["General"]);
  assertEquals(applyGeneralSentinel(["PL", "RO"]), ["General"]);
});

Deno.test("applyGeneralSentinel — 3+ рынка → General", () => {
  assertEquals(applyGeneralSentinel(["RS", "BG", "RO"]), ["General"]);
  assertEquals(applyGeneralSentinel(["HU", "RS", "MD", "General"]), ["General"]);
});

Deno.test("applyGeneralSentinel — литеральный General снимается из микса перед подсчётом", () => {
  // [RS, General] = 1 явный рынок → RS (General в миксе не должен «спасать» от схлопа и не должен оставаться)
  assertEquals(applyGeneralSentinel(["RS", "General"]), ["RS"]);
  // [SI, RS, General] = 2 явных → General
  assertEquals(applyGeneralSentinel(["SI", "RS", "General"]), ["General"]);
});

Deno.test("specificCountries — убирает литеральный General", () => {
  assertEquals(specificCountries(["RS", "General"]), ["RS"]);
  assertEquals(specificCountries(["General"]), []);
});
