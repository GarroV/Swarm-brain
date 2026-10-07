// Правило повторяемости в вебе — байт-в-байт копия канона
// `supabase/functions/_shared/tasks/recurrence-rule.ts`: превью дат в меню обязано совпадать с
// тем, куда сервер реально перекатит задачу, а подпись — с подписью в боте. Арифметику и
// подписи проверяет recurrence.test.ts на стороне сервера; здесь держим только «копия = канон».
// Правил канон — скопируй файл целиком: cp supabase/functions/_shared/tasks/recurrence-rule.ts miniapp/src/lib/recurrenceRule.ts
import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const read = (rel: string) => Deno.readTextFileSync(fromFileUrl(new URL(rel, import.meta.url)));

Deno.test("веб-копия правила повторяемости совпадает с каноном сервера", () => {
  assertEquals(
    read("./recurrenceRule.ts"),
    read("../../../supabase/functions/_shared/tasks/recurrence-rule.ts"),
    "miniapp/src/lib/recurrenceRule.ts разошёлся с каноном — скопируй файл заново",
  );
});
