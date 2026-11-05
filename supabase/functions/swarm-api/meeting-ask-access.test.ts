// Кто может спросить по встрече (#641, решение владельца 01.10.2026 про встречу на двоих:
// «другой учатсинк тоже»). Тест падает на ЧУЖОМ: третий человек обязан получить отказ.
import { assertEquals } from "jsr:@std/assert@1";
import { canAskAboutMeeting } from "./meeting-ask-access.ts";

const OWNER = 111;
const PARTNER = -37;
const THIRD = 222;

// Строка meetings: владельцы черновика. Партнёра здесь нарочно нет — право второго участника
// опубликованной встречи держится на shared_with записи, а не на составе черновика.
const draft = { group_id: "cee", recorders: [{ telegram_id: OWNER }], co_owners: [] };
const oneOnOne = { group_id: "cee", is_private: true, owner_id: OWNER, shared_with: [PARTNER] };
const shared = { group_id: "cee", is_private: false, owner_id: OWNER, shared_with: [] };

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

// Общая встреча двух пространств (решение 05.11.2026): пространство записи — по признаку
// принадлежности, как у просмотра. Правила внутри пространства те же.
Deno.test("второе пространство: видящий личную запись на двоих спрашивает и там", () => {
  const visible = { ...oneOnOne, visible_group_ids: ["cee", "world"] };
  assertEquals(canAskAboutMeeting(visible, draft, PARTNER, "world"), true);
  assertEquals(canAskAboutMeeting(visible, draft, THIRD, "world"), false);
  // Пространства нет в признаке — отказ, как раньше.
  assertEquals(canAskAboutMeeting(oneOnOne, draft, PARTNER, "world"), false);
});

Deno.test("второе пространство: по общей записи коллега из второй команды тоже НЕ спрашивает", () => {
  const visible = { ...shared, visible_group_ids: ["cee", "world"] };
  assertEquals(canAskAboutMeeting(visible, draft, THIRD, "world"), false);
});
