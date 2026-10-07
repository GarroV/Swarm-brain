import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordedByOf } from "./recorded-by.ts";

Deno.test("recordedByOf: выгрузка служебного агента — запись бота встреч", () => {
  assertEquals(recordedByOf("agent:scriba-vps:224830225"), "bot");
});

Deno.test("recordedByOf: выгрузка человека — запись рекордера", () => {
  assertEquals(recordedByOf("person:224830225"), "recorder");
});

Deno.test("recordedByOf: источник неизвестен — не угадываем", () => {
  assertEquals(recordedByOf(undefined), null);
  assertEquals(recordedByOf(""), null);
  assertEquals(recordedByOf("granola"), null);
});
