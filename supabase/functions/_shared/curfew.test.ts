// Запуск: deno test supabase/functions/_shared/curfew.test.ts
//
// Комендантский час — решение владельца 13.10.2026: ошибка в границе молчит (сообщение уходит
// в 23:00 или застревает до 10:00), поэтому границы проверены по обе стороны. Москва = UTC+3
// круглый год (без перехода на летнее время).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inCurfew } from "./curfew.ts";

Deno.test("22:59 по Москве — ещё можно", () => {
  assertEquals(inCurfew(new Date("2026-10-13T19:59:00Z")), false);
});

Deno.test("23:00 по Москве — час начался", () => {
  assertEquals(inCurfew(new Date("2026-10-13T20:00:00Z")), true);
});

Deno.test("полночь и глухая ночь — тишина", () => {
  assertEquals(inCurfew(new Date("2026-10-13T21:00:00Z")), true); // 00:00
  assertEquals(inCurfew(new Date("2026-10-14T00:30:00Z")), true); // 03:30
});

Deno.test("08:59 по Москве — ещё тишина", () => {
  assertEquals(inCurfew(new Date("2026-10-14T05:59:00Z")), true);
});

Deno.test("09:00 по Москве — можно", () => {
  assertEquals(inCurfew(new Date("2026-10-14T06:00:00Z")), false);
});

Deno.test("день — можно", () => {
  assertEquals(inCurfew(new Date("2026-10-14T12:00:00Z")), false);
});

Deno.test("зимой и летом одно и то же (Москва без перехода времени)", () => {
  assertEquals(inCurfew(new Date("2026-01-15T20:00:00Z")), true); // 23:00
  assertEquals(inCurfew(new Date("2026-07-15T19:59:00Z")), false); // 22:59
});
