// Псевдонимы полоски присутствия: без повторов, стабильно, меняются со сменой окна.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  ANIMAL_COUNT,
  assignPseudonyms,
  derivePseudonymKey,
  PSEUDONYM_WINDOW_MS,
  pseudonymWindow,
  STYLE_COUNT,
} from "./presence-pseudonyms.ts";

const KEY = await derivePseudonymKey("test-secret-a");
const OTHER_KEY = await derivePseudonymKey("test-secret-b");
const ids = (n: number) => Array.from({ length: n }, (_, i) => 700_000_000 + i * 7919);

Deno.test("до 50 участников — у каждого свой зверь, индексы в пределах набора", async () => {
  const map = await assignPseudonyms(ids(ANIMAL_COUNT), 1234, KEY);
  assertEquals(map.size, ANIMAL_COUNT);
  assertEquals(new Set([...map.values()].map((p) => p.animal)).size, ANIMAL_COUNT);
  for (const p of map.values()) {
    assert(p.animal >= 0 && p.animal < ANIMAL_COUNT);
    assert(p.style >= 0 && p.style < STYLE_COUNT);
  }
});

Deno.test("порядок входного списка не влияет на раздачу", async () => {
  const a = await assignPseudonyms(ids(12), 99, KEY);
  const b = await assignPseudonyms([...ids(12)].reverse(), 99, KEY);
  assertEquals([...a.entries()].sort(), [...b.entries()].sort());
});

Deno.test("зверь не прыгает, пока состав пространства тот же, кто бы ни был онлайн", async () => {
  // Раздача считается по всем участникам; онлайн только отбирает из готовой карты.
  const members = ids(20);
  const full = await assignPseudonyms(members, 5, KEY);
  const again = await assignPseudonyms(members, 5, KEY);
  assertEquals(full, again);
  // Вышел один человек из пространства — это уже смена состава, но набор зверей остаётся без повторов.
  const fewer = await assignPseudonyms(members.slice(1), 5, KEY);
  assertEquals(new Set([...fewer.values()].map((p) => p.animal)).size, 19);
});

Deno.test("со сменой окна звери перетасовываются", async () => {
  const members = ids(10);
  const w1 = await assignPseudonyms(members, 100, KEY);
  const w2 = await assignPseudonyms(members, 101, KEY);
  const same = members.filter((m) => w1.get(m)!.animal === w2.get(m)!.animal).length;
  assertNotEquals(same, members.length);
});

Deno.test("окно — 4 часа", () => {
  assertEquals(pseudonymWindow(0), 0);
  assertEquals(pseudonymWindow(PSEUDONYM_WINDOW_MS - 1), 0);
  assertEquals(pseudonymWindow(PSEUDONYM_WINDOW_MS), 1);
});

Deno.test("больше 50 участников — раздача не падает, зверей хватает по кругу", async () => {
  const map = await assignPseudonyms(ids(60), 7, KEY);
  assertEquals(map.size, 60);
  assertEquals(new Set([...map.values()].map((p) => p.animal)).size, ANIMAL_COUNT);
});

Deno.test("другой ключ — другая раздача (без ключа по id зверя не вычислить)", async () => {
  const members = ids(30);
  const a = await assignPseudonyms(members, 42, KEY);
  const b = await assignPseudonyms(members, 42, OTHER_KEY);
  const same = members.filter((m) => a.get(m)!.animal === b.get(m)!.animal).length;
  assertNotEquals(same, members.length);
  // Тот же ключ — та же раздача.
  assertEquals(await assignPseudonyms(members, 42, await derivePseudonymKey("test-secret-a")), a);
});

Deno.test("пустой секрет — ошибка, а не раздача по умолчанию", async () => {
  let failed = false;
  try {
    await derivePseudonymKey("");
  } catch {
    failed = true;
  }
  assert(failed);
});
