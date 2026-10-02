import { assertEquals } from "jsr:@std/assert@1";
import { actorId, actorIds, displayActor } from "./journal-actors.ts";

const names = new Map<number, string>([
  [744230399, "Вася Гарро"],
  [-30, "@google_user"],
]);

Deno.test("числовой автор показывается именем, в том числе отрицательный id Google-входа", () => {
  assertEquals(displayActor("744230399", names), "Вася Гарро");
  assertEquals(displayActor("-30", names), "@google_user");
});

Deno.test("имя и 'demo' остаются как есть, null остаётся null", () => {
  assertEquals(displayActor("Вася Гарро", names), "Вася Гарро");
  assertEquals(displayActor("demo", names), "demo");
  assertEquals(displayActor(null, names), null);
});

Deno.test("числовой автор без имени остаётся исходной строкой", () => {
  assertEquals(displayActor("123", names), "123");
});

Deno.test("actorIds собирает только числа, без повторов и без смешанных строк", () => {
  assertEquals(
    actorIds(["744230399", "demo", null, "744230399", "-30", "12abc", ""]),
    [744230399, -30],
  );
  assertEquals(actorId("1.5"), null);
});
