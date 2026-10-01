import { assertEquals } from "jsr:@std/assert@1";
import { parseListLimit, routePathOf } from "./http.ts";

Deno.test("нет параметра — дефолт", () => {
  assertEquals(parseListLimit(null, { def: 2000, max: 2000 }), 2000);
  assertEquals(parseListLimit("", { def: 500, max: 2000 }), 500);
});

Deno.test("валидное число проходит как есть", () => {
  assertEquals(parseListLimit("50", { def: 2000, max: 2000 }), 50);
});

Deno.test("выше потолка — срезаем до потолка, а не отдаём мегабайты по просьбе клиента", () => {
  assertEquals(parseListLimit("999999", { def: 2000, max: 2000 }), 2000);
});

Deno.test("мусор — дефолт, а НЕ NaN и не 0 (иначе список молча пустой)", () => {
  assertEquals(parseListLimit("abc", { def: 2000, max: 2000 }), 2000);
  assertEquals(parseListLimit("12abc", { def: 2000, max: 2000 }), 12); // parseInt читает префикс — это ок
});

Deno.test("ноль и отрицательное — дефолт: «столько» просить бессмысленно", () => {
  assertEquals(parseListLimit("0", { def: 2000, max: 2000 }), 2000);
  assertEquals(parseListLimit("-5", { def: 2000, max: 2000 }), 2000);
});

Deno.test("дефолт сам не может превысить потолок", () => {
  assertEquals(parseListLimit(null, { def: 9000, max: 2000 }), 2000);
});

Deno.test("routePathOf: снимает один префикс функции (#592)", () => {
  assertEquals(routePathOf("/functions/v1/swarm-api/tasks"), "/tasks");
  assertEquals(routePathOf("/swarm-api/tasks/1"), "/tasks/1");
  assertEquals(routePathOf("/swarm-api"), "/");
  assertEquals(routePathOf("/swarm-api/"), "/");
});

Deno.test("routePathOf: подстрока /swarm-api внутри пути не переносит маршрут", () => {
  assertEquals(routePathOf("/swarm-api/entries/x/swarm-api/me"), "/entries/x/swarm-api/me");
  assertEquals(routePathOf("/swarm-apix/me"), "/swarm-apix/me");
});
