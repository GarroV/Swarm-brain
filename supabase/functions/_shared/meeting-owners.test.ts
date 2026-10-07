import { assertEquals } from "jsr:@std/assert@1";
import { coOwnersFromAttendees, mergeAttendees } from "./meeting-owners.ts";

// Решение владельца 2026-09-25 (п. 26–27 журнала cards-in-panel): у черновика встречи несколько
// владельцев — кто записывал, плюс участники встречи, у которых есть SWARM. Совладельцев
// считаем по e-mail из приглашения, только внутри воркспейса встречи.

const MEMBERS = [
  { telegram_id: 1, email: "anna@x.io" },
  { telegram_id: 2, email: "boris@x.io" },
  { telegram_id: null, email: "invited@x.io" }, // приглашён, но ещё не входил
  { telegram_id: 3, email: null },
];

Deno.test("участник встречи с аккаунтом SWARM становится совладельцем", () => {
  const got = coOwnersFromAttendees(
    [{ email: "Boris@X.io " }, { email: "outsider@y.com" }],
    MEMBERS,
    [1],
  );
  assertEquals(got, [2]);
});

Deno.test("1-1 с внешним человеком — совладельцев нет, остаётся только записавший", () => {
  assertEquals(coOwnersFromAttendees([{ email: "outsider@y.com" }], MEMBERS, [1]), []);
});

Deno.test("записавший в совладельцы не дублируется, повторы схлопываются", () => {
  const got = coOwnersFromAttendees(
    [{ email: "anna@x.io" }, { email: "boris@x.io" }, { email: "BORIS@x.io" }],
    MEMBERS,
    [1],
  );
  assertEquals(got, [2]);
});

Deno.test("без участников, без e-mail, приглашённый без входа — никого", () => {
  assertEquals(coOwnersFromAttendees(null, MEMBERS, [1]), []);
  assertEquals(coOwnersFromAttendees([{ name: "Без почты" }, { email: "" }], MEMBERS, [1]), []);
  assertEquals(coOwnersFromAttendees([{ email: "invited@x.io" }], MEMBERS, [1]), []);
});

Deno.test("склейка участников: новые дописываются, повторы по e-mail — нет", () => {
  const got = mergeAttendees(
    [{ email: "anna@x.io", name: "Anna" }],
    [{ email: "ANNA@x.io" }, { email: "boris@x.io", name: "Boris" }, { name: "без почты" }],
  );
  assertEquals(got, [{ email: "anna@x.io", name: "Anna" }, { email: "boris@x.io", name: "Boris" }]);
  assertEquals(mergeAttendees(null, null), []);
});
