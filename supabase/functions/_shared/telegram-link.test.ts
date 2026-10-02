import { assertEquals, assertNotEquals } from "@std/assert";
import { hashLinkCode, linkDeepLink, newLinkCode, parseLinkStart } from "./telegram-link.ts";

Deno.test("код ссылки проходит в start-параметр Telegram и разбирается обратно", () => {
  const code = newLinkCode();
  assertEquals(/^[A-Za-z0-9_-]{32}$/.test(code), true);
  const url = linkDeepLink("swarm_bot", code);
  const param = new URL(url).searchParams.get("start")!;
  assertEquals(param.length <= 64, true);
  assertEquals(parseLinkStart(`/start ${param}`), code);
  assertEquals(parseLinkStart(`/start@swarm_bot ${param}`), code);
});

Deno.test("обычный /start и мусор привязкой не считаются", () => {
  assertEquals(parseLinkStart("/start"), null);
  assertEquals(parseLinkStart("/start hello"), null);
  assertEquals(parseLinkStart("/start link_short"), null);
  assertEquals(parseLinkStart("hi /start link_aaaaaaaaaaaaaaaaaaaa"), null);
  assertEquals(parseLinkStart(undefined), null);
});

Deno.test("хеш кода детерминирован и различает коды", async () => {
  const a = newLinkCode();
  assertEquals(await hashLinkCode(a), await hashLinkCode(a));
  assertNotEquals(await hashLinkCode(a), await hashLinkCode(newLinkCode()));
});
