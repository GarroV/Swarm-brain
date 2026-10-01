import { assertEquals } from "jsr:@std/assert@1";
import { isNetworkFailure, nextConnection, ONLINE } from "./connection.ts";

Deno.test("обрыв переводит в «нет связи» и запоминает, с какого времени", () => {
  assertEquals(nextConnection(ONLINE, "network_error", 1000), { offline: true, since: 1000 });
});

Deno.test("повторный обрыв не сдвигает время начала", () => {
  const off = nextConnection(ONLINE, "network_error", 1000);
  assertEquals(nextConnection(off, "network_error", 5000), { offline: true, since: 1000 });
});

Deno.test("любой ответ сервера возвращает связь", () => {
  const off = nextConnection(ONLINE, "network_error", 1000);
  assertEquals(nextConnection(off, "response", 2000), ONLINE);
  assertEquals(nextConnection(ONLINE, "response", 2000), ONLINE);
});

Deno.test("обрыв — это TypeError от fetch, а не отмена и не ошибка сервера", () => {
  assertEquals(isNetworkFailure(new TypeError("Failed to fetch")), true);
  const abort = new DOMException("aborted", "AbortError");
  assertEquals(isNetworkFailure(abort), false);
  assertEquals(isNetworkFailure(new Error("500")), false);
  assertEquals(isNetworkFailure("oops"), false);
});
