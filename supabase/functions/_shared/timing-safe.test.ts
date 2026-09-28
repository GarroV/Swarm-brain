import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { timingSafeEq } from "./timing-safe.ts";

Deno.test("равные строки совпадают", () => {
  assertEquals(timingSafeEq("s3cret-value", "s3cret-value"), true);
});

Deno.test("разные строки одинаковой длины не совпадают", () => {
  assertEquals(timingSafeEq("s3cret-value", "s3cret-valuX"), false);
});

Deno.test("разная длина не совпадает", () => {
  assertEquals(timingSafeEq("short", "short-and-longer"), false);
});

Deno.test("пустая строка не совпадает с непустой", () => {
  assertEquals(timingSafeEq("", "secret"), false);
});

Deno.test("две пустые строки формально равны — вызывающий обязан проверять, что секрет задан", () => {
  assertEquals(timingSafeEq("", ""), true);
});

Deno.test("различие в первом символе ловится так же, как в последнем", () => {
  assertEquals(timingSafeEq("Xecret", "secret"), false);
  assertEquals(timingSafeEq("secreX", "secret"), false);
});
