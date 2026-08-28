import { assertEquals } from "jsr:@std/assert@1";
import { applyGeneralSentinel, marketTagsFromInput, specificCountries } from "./meta-extract.ts";

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

// marketTagsFromInput — рынки, пришедшие ОТ КЛИЕНТА (чипы на вычитке), в теги записи.
// Регрессия issue #166: PATCH прогонял ["General"] через normalizeCountries и получал [] —
// сентинел стирался, запись выпадала из дайджеста совсем.
// Регрессия issue #167: порог 2+ обязан применяться и к ручному выбору (решение владельца 2026-08-28).

Deno.test("marketTagsFromInput — сентинел General выживает нормализацию (issue #166)", () => {
  assertEquals(marketTagsFromInput(["General"]), ["General"]);
});

Deno.test("marketTagsFromInput — пустой выбор = «Общее», а не отсутствие тега", () => {
  assertEquals(marketTagsFromInput([]), ["General"]);
});

Deno.test("marketTagsFromInput — ровно один рынок остаётся тегом и нормализуется в ISO", () => {
  assertEquals(marketTagsFromInput(["RS"]), ["RS"]);
  assertEquals(marketTagsFromInput(["Bulgaria"]), ["BG"]);
  assertEquals(marketTagsFromInput(["Сербия"]), ["RS"]);
});

Deno.test("marketTagsFromInput — 2+ рынка схлопываются в General даже при ручном выборе (issue #167)", () => {
  assertEquals(marketTagsFromInput(["RS", "BG"]), ["General"]);
  assertEquals(marketTagsFromInput(["RS", "BG", "RO"]), ["General"]);
  assertEquals(marketTagsFromInput(["RS", "General"]), ["RS"]);
});

Deno.test("marketTagsFromInput — нераспознанный мусор не превращается в «нет тега»", () => {
  assertEquals(marketTagsFromInput(["Неведомая страна"]), ["General"]);
  assertEquals(marketTagsFromInput(["", "  "]), ["General"]);
});
