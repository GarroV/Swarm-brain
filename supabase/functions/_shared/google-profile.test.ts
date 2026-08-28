import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nameSigPayload, normalizeName, profileNameUpdate } from "./google-profile.ts";

Deno.test("normalizeName: пусто и мусор → null", () => {
  assertEquals(normalizeName(undefined), null);
  assertEquals(normalizeName(null), null);
  assertEquals(normalizeName("   "), null);
  assertEquals(normalizeName("\n\t"), null);
});

Deno.test("normalizeName: тримит и режет по длине колонки", () => {
  assertEquals(normalizeName("  Вадим  "), "Вадим");
  assertEquals(normalizeName("x".repeat(200))?.length, 120);
});

Deno.test("nameSigPayload: имя входит в подписываемую строку", () => {
  assertEquals(
    nameSigPayload("v.garro@dodobrands.io", { given: "Вадим", family: "Гарро" }),
    "v.garro@dodobrands.io|Вадим|Гарро",
  );
});

Deno.test("nameSigPayload: пустые части дают стабильную строку, а не undefined", () => {
  assertEquals(nameSigPayload("a@b.io", {}), "a@b.io||");
  assertEquals(nameSigPayload("a@b.io", { given: " Anna ", family: null }), "a@b.io|Anna|");
});

Deno.test("profileNameUpdate: профиля нет → заполняем оба поля", () => {
  assertEquals(
    profileNameUpdate(null, { given: "Anna", family: "Petrova" }),
    { first_name: "Anna", last_name: "Petrova" },
  );
});

Deno.test("profileNameUpdate: заполненное руками НЕ перетираем", () => {
  assertEquals(
    profileNameUpdate({ first_name: "Аня", last_name: "П." }, { given: "Anna", family: "Petrova" }),
    null,
  );
});

Deno.test("profileNameUpdate: дозаполняем только пустое поле", () => {
  assertEquals(
    profileNameUpdate({ first_name: "Аня", last_name: null }, { given: "Anna", family: "Petrova" }),
    { last_name: "Petrova" },
  );
  assertEquals(
    profileNameUpdate({ first_name: "", last_name: "П." }, { given: "Anna", family: "Petrova" }),
    { first_name: "Anna" },
  );
});

Deno.test("profileNameUpdate: имени от Google нет → писать нечего", () => {
  assertEquals(profileNameUpdate(null, {}), null);
  assertEquals(profileNameUpdate({ first_name: null, last_name: null }, { given: "  " }), null);
});

Deno.test("profileNameUpdate: пробелы в существующем значении считаются пустотой", () => {
  assertEquals(
    profileNameUpdate({ first_name: "   ", last_name: null }, { given: "Anna", family: null }),
    { first_name: "Anna" },
  );
});
