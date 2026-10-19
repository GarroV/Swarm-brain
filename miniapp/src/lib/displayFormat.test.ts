import { assertEquals } from "jsr:@std/assert@1";
import { formatDate, formatDay, isRawId } from "./displayFormat.ts";

Deno.test("isRawId: положительный и отрицательный id — сырой номер", () => {
  assertEquals(isRawId("744230399"), true);
  assertEquals(isRawId("-30"), true);
  assertEquals(isRawId(" 12 "), true);
});

Deno.test("isRawId: имя, e-mail и пустое — не номер", () => {
  assertEquals(isRawId("Анна"), false);
  assertEquals(isRawId("a@b.co"), false);
  assertEquals(isRawId("-"), false);
  assertEquals(isRawId(""), false);
  assertEquals(isRawId(null), false);
});

Deno.test("formatDate: битая строка и пустое — null, а не «Invalid Date»", () => {
  assertEquals(formatDate("не дата", { day: "numeric" }), null);
  assertEquals(formatDate("", { day: "numeric" }), null);
  assertEquals(formatDate(null, { day: "numeric" }), null);
});

Deno.test("formatDate: нормальная дата форматируется", () => {
  assertEquals(formatDate("2026-10-02T10:00:00Z", { day: "numeric", timeZone: "UTC" }, "en-US"), "2");
});

Deno.test("formatDay: голый день читается как местный и не уезжает на вчера", () => {
  assertEquals(formatDay("2026-10-16", "en-GB"), "16 Oct");
  assertEquals(formatDay("2026-10-16T00:00:00Z", "en-GB"), "16 Oct");
  assertEquals(formatDay("мусор", "en-GB"), "мусор");
});
