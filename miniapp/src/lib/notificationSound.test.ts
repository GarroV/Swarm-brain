import { assertEquals } from "@std/assert";
import { createUnreadObserver, shouldChime } from "./notificationSound.ts";

Deno.test("звук: первая загрузка молчит, рост счётчика звонит, убыль и то же число — нет", () => {
  assertEquals(shouldChime(null, 5), false);
  assertEquals(shouldChime(0, 1), true);
  assertEquals(shouldChime(3, 4), true);
  assertEquals(shouldChime(3, 3), false);
  assertEquals(shouldChime(3, 0), false);
});

Deno.test("звук: наблюдатель сравнивает с прошлым опросом, второй экземпляр колокольчика не дублирует", () => {
  const o = createUnreadObserver();
  assertEquals(o.observe(2), false); // первая загрузка страницы
  assertEquals(o.observe(2), false);
  assertEquals(o.observe(3), true); // пришло новое
  assertEquals(o.observe(3), false); // второй колокольчик увидел то же число
  assertEquals(o.observe(0), false); // прочитал всё
  assertEquals(o.observe(1), true); // снова новое после нуля
});
