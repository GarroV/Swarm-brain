// Кто может спросить по встрече (#641, решение владельца 01.10.2026 про встречу на двоих:
// «другой учатсинк тоже»). Тест падает на ЧУЖОМ: третий человек обязан получить отказ.
import { assertEquals } from "jsr:@std/assert@1";
import { canAskAboutMeeting } from "./meeting-ask.ts";

const OWNER = 111;
const PARTNER = -37;
const THIRD = 222;

// Строка meetings: владельцы черновика. Партнёра здесь нарочно нет — право второго участника
// опубликованной встречи держится на shared_with записи, а не на составе черновика.
const draft = { group_id: "cee", recorders: [{ telegram_id: OWNER }], co_owners: [] };
const oneOnOne = { is_private: true, owner_id: OWNER, shared_with: [PARTNER] };
const shared = { is_private: false, owner_id: OWNER, shared_with: [] };

Deno.test("встреча на двоих: второй участник может спросить", () => {
  assertEquals(canAskAboutMeeting(oneOnOne, draft, PARTNER, "cee"), true);
});

Deno.test("встреча на двоих: третий не может", () => {
  assertEquals(canAskAboutMeeting(oneOnOne, draft, THIRD, "cee"), false);
});

Deno.test("встреча на двоих: второй участник из чужого воркспейса не может", () => {
  assertEquals(canAskAboutMeeting(oneOnOne, draft, PARTNER, "other"), false);
});

Deno.test("общая встреча: коллега, видящий тезисы, по транскрипту НЕ спрашивает", () => {
  // Прежнее правило: ответ пересказывает сырую запись, а её видят только владельцы черновика.
  assertEquals(canAskAboutMeeting(shared, draft, THIRD, "cee"), false);
});

Deno.test("общая встреча: записавший спрашивает", () => {
  assertEquals(canAskAboutMeeting(shared, draft, OWNER, "cee"), true);
});

Deno.test("черновик (записи ещё нет): только владельцы черновика", () => {
  assertEquals(canAskAboutMeeting(null, draft, OWNER, "cee"), true);
  assertEquals(canAskAboutMeeting(null, draft, PARTNER, "cee"), false);
});

Deno.test("встречи нет — отказ", () => {
  assertEquals(canAskAboutMeeting(oneOnOne, null, PARTNER, "cee"), false);
});
