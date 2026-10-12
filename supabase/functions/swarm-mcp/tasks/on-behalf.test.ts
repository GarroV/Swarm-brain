import { assertEquals } from "jsr:@std/assert@1";
import { onBehalfDenial, shouldMuteCreator } from "./on-behalf.ts";

const caller = { telegramId: 1, groupId: "ws", isAdmin: true };

Deno.test("onBehalfDenial: админ ставит создателем участника своего пространства", () => {
  assertEquals(onBehalfDenial(caller, { telegramId: 2, groupId: "ws" }), null);
});

Deno.test("onBehalfDenial: не админ — отказ, даже на коллегу из своего пространства", () => {
  const r = onBehalfDenial({ ...caller, isAdmin: false }, { telegramId: 2, groupId: "ws" });
  assertEquals(typeof r, "string");
});

Deno.test("onBehalfDenial: человек из чужого пространства — отказ", () => {
  assertEquals(typeof onBehalfDenial(caller, { telegramId: 2, groupId: "other" }), "string");
});

Deno.test("onBehalfDenial: человек не найден или без пространства — отказ", () => {
  assertEquals(typeof onBehalfDenial(caller, null), "string");
  assertEquals(typeof onBehalfDenial(caller, { telegramId: 2, groupId: null }), "string");
});

Deno.test("onBehalfDenial: сам себя — не подмена, отказа нет", () => {
  assertEquals(onBehalfDenial({ ...caller, isAdmin: false }, { telegramId: 1, groupId: "ws" }), null);
});

Deno.test("shouldMuteCreator: подставленному создателю — тишина, если он не исполнитель", () => {
  assertEquals(shouldMuteCreator({ creator: 2, caller: 1, assignees: [3], mute: true }), true);
});

Deno.test("shouldMuteCreator: исполнитель уведомления получает — не глушим", () => {
  assertEquals(shouldMuteCreator({ creator: 2, caller: 1, assignees: [2], mute: true }), false);
});

Deno.test("shouldMuteCreator: попросили не глушить или создатель — сам вызывающий", () => {
  assertEquals(shouldMuteCreator({ creator: 2, caller: 1, assignees: [], mute: false }), false);
  assertEquals(shouldMuteCreator({ creator: 1, caller: 1, assignees: [], mute: true }), false);
});
