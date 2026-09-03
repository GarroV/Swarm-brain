// Контекст созвона для панели заметок рекордера (issue #226).
// Решения владельца 03.09.2026: «эта сторона = эта страна», «тезисы последней встречи»,
// «задачи показываем связанные с этой встречей», функционал нужен для регулярных встреч.
import { assertEquals } from "jsr:@std/assert";
import { contextCountry, tezisyPreview, mergeContextTasks, PREVIEW_LIMITS } from "./meeting-context.ts";

Deno.test("страна созвона берётся из названия встречи", () => {
  // Название — самый прямой сигнал: «созвон с Болгарией» у рекордера так и называется.
  assertEquals(contextCountry("Dodo Pizza Bulgaria", []), "BG");
  assertEquals(contextCountry("Wolt Bulgaria with team", []), "BG");
  assertEquals(contextCountry("IMF - Слот под комитет Четверг", []), null);
});

Deno.test("страна падает на рынки участников, когда в названии её нет", () => {
  // Общий рынок у всех участников — законный сигнал (тот же приоритет, что в market-suggest).
  assertEquals(contextCountry("Weekly sync", [["BG"], ["BG"]]), "BG");
  // Разные рынки — кросс-маркет, гадать нельзя.
  assertEquals(contextCountry("Weekly sync", [["BG"], ["RS"]]), null);
});

Deno.test("превью тезисов: заголовки разделов и первые пункты", () => {
  const md = [
    "### Болгария",
    "- Бургас: не хватает курьеров, спрос выше мощностей",
    "- Тематическая коробка: продажи 35 дней",
    "### Персонал",
    "- Николь второй месяц в команде",
    "### Решения и договорённости",
    "- решили считать P&L по новой схеме",
  ].join("\n");

  const p = tezisyPreview(md);

  assertEquals(p.sections, ["Болгария", "Персонал", "Решения и договорённости"]);
  assertEquals(p.bullets.length, PREVIEW_LIMITS.bullets);
  assertEquals(p.bullets[0], "Бургас: не хватает курьеров, спрос выше мощностей");
  assertEquals(p.totalBullets, 4);
});

Deno.test("превью не режет слова посередине и помечает обрезанный пункт", () => {
  const long = "а".repeat(PREVIEW_LIMITS.bulletChars + 40);
  const p = tezisyPreview(`### Тема\n- ${long}`);
  assertEquals(p.bullets[0].length <= PREVIEW_LIMITS.bulletChars + 1, true);
  assertEquals(p.bullets[0].endsWith("…"), true);
});

Deno.test("пустые и мусорные тезисы не роняют превью", () => {
  assertEquals(tezisyPreview("").totalBullets, 0);
  assertEquals(tezisyPreview("").sections, []);
  // Текст без разметки — тоже контент: показываем как пункт, а не пустоту.
  const plain = tezisyPreview("просто текст без разметки");
  assertEquals(plain.bullets, ["просто текст без разметки"]);
  assertEquals(plain.sections, []);
});

Deno.test("полный текст помечается усечённым только когда правда обрезан", () => {
  const small = tezisyPreview("### Тема\n- пункт");
  assertEquals(small.truncated, false);
  const big = tezisyPreview("### Тема\n" + "- пункт с деталями\n".repeat(4000));
  assertEquals(big.truncated, true);
  assertEquals(big.fullText.length <= PREVIEW_LIMITS.fullChars, true);
});

Deno.test("маркеры списка распознаются в обоих написаниях", () => {
  const p = tezisyPreview("### Тема\n* звёздочкой\n- дефисом");
  assertEquals(p.totalBullets, 2);
});

Deno.test("задачи встречи идут первыми, задачи страны добивают остаток", () => {
  const meeting = [{ id: "m1" }, { id: "m2" }];
  const country = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];

  const merged = mergeContextTasks(meeting, country, 4);

  assertEquals(merged.map((t) => t.id), ["m1", "m2", "c1", "c2"]);
  assertEquals(merged.map((t) => t.source), ["meeting", "meeting", "country", "country"]);
});

Deno.test("одна и та же задача не задваивается", () => {
  // Задача встречи, у которой ещё и страна совпала, приходит в обеих выборках.
  const merged = mergeContextTasks([{ id: "x" }], [{ id: "x" }, { id: "y" }], 5);
  assertEquals(merged.map((t) => t.id), ["x", "y"]);
  assertEquals(merged[0].source, "meeting");
});

Deno.test("лимит соблюдается, задачи встречи не вытесняются страновыми", () => {
  const meeting = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  const merged = mergeContextTasks(meeting, [{ id: "c1" }], 2);
  assertEquals(merged.map((t) => t.id), ["m1", "m2"]);
});
