// Срок обязателен, значение по умолчанию — завтра (решение владельца 21.09.2026).
import { assertEquals } from "jsr:@std/assert";
import { addDays, defaultDueDate } from "./due.ts";

Deno.test("addDays: обычный день", () => {
  assertEquals(addDays("2026-09-21", 1), "2026-09-22");
});

Deno.test("addDays: переход через конец месяца и года", () => {
  assertEquals(addDays("2026-09-30", 1), "2026-10-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
});

Deno.test("addDays: високосный февраль", () => {
  assertEquals(addDays("2028-02-28", 1), "2028-02-29");
});

Deno.test("addDays: +7 — шаг разбора старых задач без срока", () => {
  assertEquals(addDays("2026-09-21", 7), "2026-09-28");
});

Deno.test("defaultDueDate: завтра по времени команды, а не по UTC", () => {
  // 21 сентября 23:30 UTC = уже 22-е в Белграде (UTC+2), значит срок — 23-е.
  assertEquals(defaultDueDate(new Date("2026-09-21T23:30:00Z")), "2026-09-23");
  // 21 сентября 09:00 UTC = то же 21-е в Белграде, значит срок — 22-е.
  assertEquals(defaultDueDate(new Date("2026-09-21T09:00:00Z")), "2026-09-22");
});
