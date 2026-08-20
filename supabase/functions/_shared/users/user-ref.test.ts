import { assertEquals } from "jsr:@std/assert@1";
import { parseUserRef } from "./user-ref.ts";

Deno.test("числовой сегмент → telegram_id", () => {
  assertEquals(parseUserRef("744230399"), { kind: "telegram", telegramId: 744230399 });
});

Deno.test("синтетический (отрицательный) telegram_id email-only юзера тоже распознаётся", () => {
  assertEquals(parseUserRef("-28"), { kind: "telegram", telegramId: -28 });
});

Deno.test("email → нормализованный lower/trim", () => {
  assertEquals(parseUserRef("  F.Davurov@Dodobrands.IO "), {
    kind: "email",
    email: "f.davurov@dodobrands.io",
  });
});

Deno.test("username с @ и без — одна и та же нормализованная форма", () => {
  assertEquals(parseUserRef("@Faruche"), { kind: "username", username: "faruche" });
  assertEquals(parseUserRef("faruche"), { kind: "username", username: "faruche" });
});

Deno.test("пустая строка и нули — invalid (не адресуют ничью строку)", () => {
  assertEquals(parseUserRef(""), { kind: "invalid" });
  assertEquals(parseUserRef("   "), { kind: "invalid" });
  assertEquals(parseUserRef("0"), { kind: "invalid" });
});

Deno.test("обрывок email (без домена или без TLD) — username, а не email", () => {
  assertEquals(parseUserRef("f.davurov@"), { kind: "username", username: "f.davurov@" });
  assertEquals(parseUserRef("f.davurov@dodobrands"), { kind: "username", username: "f.davurov@dodobrands" });
});
