// Контекст созвона для панели заметок рекордера (issue #226).
// Решения владельца 03.09.2026: «эта сторона = эта страна», «тезисы последней встречи»,
// а задачи и тезисы «никак и не должны соприкасаться — это разные вещи»: тезисы у последней
// встречи, задачи у стороны (страны) текущего созвона, одно от другого не зависит.
import { assertEquals } from "jsr:@std/assert";
import { contextCountry, tezisyPreview, PREVIEW_LIMITS } from "./meeting-context.ts";

Deno.test("страна берётся из ЯВНОГО указания в названии встречи", () => {
  // «у нас все встречи со странами прям явно прописаны в названии встречи» — владелец.
  assertEquals(contextCountry("Dodo Pizza Bulgaria"), "BG");
  assertEquals(contextCountry("Wolt Bulgaria with team"), "BG");
});

Deno.test("без явного указания страны — null, догадок не делаем", () => {
  // Ни по участникам, ни по смыслу: тезисы чужой страны хуже пустого блока.
  assertEquals(contextCountry("IMF - Слот под комитет Четверг"), null);
  assertEquals(contextCountry("Weekly sync"), null);
  assertEquals(contextCountry(""), null);
  assertEquals(contextCountry(null), null);
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
