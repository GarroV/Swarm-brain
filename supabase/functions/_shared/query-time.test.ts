import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectQuerySinceDays } from "./query-time.ts";

Deno.test("явное число + единица", () => {
  assertEquals(detectQuerySinceDays("дай апдейт за последние 2 недели"), 14);
  assertEquals(detectQuerySinceDays("что было за 3 дня"), 3);
  assertEquals(detectQuerySinceDays("итоги за последний месяц"), 30);
  assertEquals(detectQuerySinceDays("last 2 weeks summary"), 14);
});

Deno.test("число словом", () => {
  assertEquals(detectQuerySinceDays("за две недели"), 14);
  assertEquals(detectQuerySinceDays("за пару недель"), 14);
});

Deno.test("единица без числа = 1", () => {
  assertEquals(detectQuerySinceDays("за неделю"), 7);
  assertEquals(detectQuerySinceDays("за месяц"), 30);
});

Deno.test("обобщённая свежесть → окно по умолчанию 14", () => {
  assertEquals(detectQuerySinceDays("последние новости"), 14);
  assertEquals(detectQuerySinceDays("что нового"), 14);
  assertEquals(detectQuerySinceDays("свежие апдейты"), 14);
});

Deno.test("не временной запрос → null", () => {
  assertEquals(detectQuerySinceDays("что решили по Испании"), null);
  assertEquals(detectQuerySinceDays("контакты поставщика сыра"), null);
  assertEquals(detectQuerySinceDays(""), null);
});

Deno.test("потолок 365", () => {
  assertEquals(detectQuerySinceDays("за 5 лет"), 365);
});
