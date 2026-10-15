// Псевдонимы полоски присутствия: без повторов, стабильно, меняются со сменой окна.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  ANIMAL_COUNT,
  assignPseudonyms,
  PSEUDONYM_WINDOW_MS,
  pseudonymWindow,
  STYLE_COUNT,
} from "./presence-pseudonyms.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => 700_000_000 + i * 7919);

Deno.test("до 50 участников — у каждого свой зверь, индексы в пределах набора", () => {
  const map = assignPseudonyms(ids(ANIMAL_COUNT), 1234);
  assertEquals(map.size, ANIMAL_COUNT);
  assertEquals(new Set([...map.values()].map((p) => p.animal)).size, ANIMAL_COUNT);
  for (const p of map.values()) {
    assert(p.animal >= 0 && p.animal < ANIMAL_COUNT);
    assert(p.style >= 0 && p.style < STYLE_COUNT);
  }
});

Deno.test("порядок входного списка не влияет на раздачу", () => {
  const a = assignPseudonyms(ids(12), 99);
  const b = assignPseudonyms([...ids(12)].reverse(), 99);
  assertEquals([...a.entries()].sort(), [...b.entries()].sort());
});

Deno.test("зверь не прыгает, пока состав пространства тот же, кто бы ни был онлайн", () => {
  // Раздача считается по всем участникам; онлайн только отбирает из готовой карты.
  const members = ids(20);
  const full = assignPseudonyms(members, 5);
  const again = assignPseudonyms(members, 5);
  assertEquals(full, again);
  // Вышел один человек из пространства — это уже смена состава, но набор зверей остаётся без повторов.
  const fewer = assignPseudonyms(members.slice(1), 5);
  assertEquals(new Set([...fewer.values()].map((p) => p.animal)).size, 19);
});

Deno.test("со сменой окна звери перетасовываются", () => {
  const members = ids(10);
  const w1 = assignPseudonyms(members, 100);
  const w2 = assignPseudonyms(members, 101);
  const same = members.filter((m) => w1.get(m)!.animal === w2.get(m)!.animal).length;
  assertNotEquals(same, members.length);
});

Deno.test("окно — 4 часа", () => {
  assertEquals(pseudonymWindow(0), 0);
  assertEquals(pseudonymWindow(PSEUDONYM_WINDOW_MS - 1), 0);
  assertEquals(pseudonymWindow(PSEUDONYM_WINDOW_MS), 1);
});

Deno.test("больше 50 участников — раздача не падает, зверей хватает по кругу", () => {
  const map = assignPseudonyms(ids(60), 7);
  assertEquals(map.size, 60);
  assertEquals(new Set([...map.values()].map((p) => p.animal)).size, ANIMAL_COUNT);
});
