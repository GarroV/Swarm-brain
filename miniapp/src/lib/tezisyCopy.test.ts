import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTezisyCopyText, longDate } from "./tezisyCopy.ts";

const RU = { notice: "Обработано с помощью AI", meeting: "Встреча", locale: "ru-RU" };
const EN = { notice: "Processed with AI", meeting: "Meeting", locale: "en-US" };

Deno.test("шапка: крупно встреча и полная дата, под ними мелко пометка об AI — потом пустая строка и тезисы", () => {
  const out = buildTezisyCopyText("🌍 Рынки\n• Сербия — план", { title: "IMF BD", date: "2026-09-03T07:54:56Z" }, RU);
  assertEquals(out, "# IMF BD · 3 сентября 2026\n_Обработано с помощью AI_\n\n🌍 Рынки\n• Сербия — план");
});

Deno.test("английская локаль подставляет свои строки и формат даты", () => {
  const out = buildTezisyCopyText("Markets", { title: "IMF BD", date: "2026-09-03T07:54:56Z" }, EN);
  assertEquals(out, "# IMF BD · September 3, 2026\n_Processed with AI_\n\nMarkets");
});

Deno.test("без названия остаётся только дата", () => {
  const out = buildTezisyCopyText("текст", { date: "2026-09-03T07:54:56Z" }, RU);
  assertEquals(out, "# Встреча · 3 сентября 2026\n_Обработано с помощью AI_\n\nтекст");
});

Deno.test("без даты остаётся только название", () => {
  const out = buildTezisyCopyText("текст", { title: "Планёрка" }, RU);
  assertEquals(out, "# Планёрка\n_Обработано с помощью AI_\n\nтекст");
});

Deno.test("пометка об AI есть даже когда контекста нет совсем", () => {
  assertEquals(buildTezisyCopyText("текст", {}, RU), "_Обработано с помощью AI_\n\nтекст");
});

Deno.test("пустые тезисы не дают висящей пустой строки", () => {
  assertEquals(buildTezisyCopyText("   ", { title: "Планёрка" }, RU), "# Планёрка\n_Обработано с помощью AI_");
});

Deno.test("кривая дата молча пропускается, а не ломает копию", () => {
  assertEquals(longDate("не-дата", "ru-RU"), null);
  assertEquals(buildTezisyCopyText("текст", { title: "X", date: "не-дата" }, RU), "# X\n_Обработано с помощью AI_\n\nтекст");
});

Deno.test("пробелы в названии обрезаются", () => {
  assertEquals(buildTezisyCopyText("t", { title: "  X  " }, RU), "# X\n_Обработано с помощью AI_\n\nt");
});
