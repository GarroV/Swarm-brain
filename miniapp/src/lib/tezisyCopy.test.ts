import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTezisyCopyText, longDate } from "./tezisyCopy.ts";

const RU = { notice: "Обработано с помощью AI", meeting: "Встреча", locale: "ru-RU" };
const EN = { notice: "Processed with AI", meeting: "Meeting", locale: "en-US" };

Deno.test("шапка: пометка об AI, встреча и полная дата — потом пустая строка и тезисы", () => {
  const out = buildTezisyCopyText("🌍 Рынки\n• Сербия — план", { title: "IMF BD", date: "2026-09-03T07:54:56Z" }, RU);
  assertEquals(out, "Обработано с помощью AI\nВстреча: IMF BD · 3 сентября 2026\n\n🌍 Рынки\n• Сербия — план");
});

Deno.test("английская локаль подставляет свои строки и формат даты", () => {
  const out = buildTezisyCopyText("Markets", { title: "IMF BD", date: "2026-09-03T07:54:56Z" }, EN);
  assertEquals(out, "Processed with AI\nMeeting: IMF BD · September 3, 2026\n\nMarkets");
});

Deno.test("без названия остаётся только дата", () => {
  const out = buildTezisyCopyText("текст", { date: "2026-09-03T07:54:56Z" }, RU);
  assertEquals(out, "Обработано с помощью AI\nВстреча: 3 сентября 2026\n\nтекст");
});

Deno.test("без даты остаётся только название", () => {
  const out = buildTezisyCopyText("текст", { title: "Планёрка" }, RU);
  assertEquals(out, "Обработано с помощью AI\nВстреча: Планёрка\n\nтекст");
});

Deno.test("пометка об AI есть даже когда контекста нет совсем", () => {
  assertEquals(buildTezisyCopyText("текст", {}, RU), "Обработано с помощью AI\n\nтекст");
});

Deno.test("пустые тезисы не дают висящей пустой строки", () => {
  assertEquals(buildTezisyCopyText("   ", { title: "Планёрка" }, RU), "Обработано с помощью AI\nВстреча: Планёрка");
});

Deno.test("кривая дата молча пропускается, а не ломает копию", () => {
  assertEquals(longDate("не-дата", "ru-RU"), null);
  assertEquals(buildTezisyCopyText("текст", { title: "X", date: "не-дата" }, RU), "Обработано с помощью AI\nВстреча: X\n\nтекст");
});

Deno.test("пробелы в названии обрезаются", () => {
  assertEquals(buildTezisyCopyText("t", { title: "  X  " }, RU), "Обработано с помощью AI\nВстреча: X\n\nt");
});
