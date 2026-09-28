import { assertEquals } from "@std/assert";
import { avatarTone, initials } from "./people.ts";

Deno.test("инициалы: имя и фамилия — по первой букве каждого", () => {
  assertEquals(initials("Vasiliy Garro"), "VG");
  assertEquals(initials("Ксения Забардаева"), "КЗ");
});

Deno.test("инициалы: односложное имя — две первые буквы", () => {
  // «А» в кружке неотличима у Ани и Артёма; две буквы различают их без подсказки.
  assertEquals(initials("Аня"), "АН");
  assertEquals(initials("garro"), "GA");
});

Deno.test("инициалы: пустое имя даёт «?», а не пустой кружок", () => {
  assertEquals(initials("   "), "?");
});

Deno.test("цвет кружка у человека один и тот же", () => {
  // Разъехавшись между экранами, тон превращает одного человека в двух.
  assertEquals(avatarTone("Vasiliy Garro"), avatarTone("Vasiliy Garro"));
});
