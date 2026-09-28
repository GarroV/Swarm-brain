// Запуск: npm run test (в miniapp/)
import { assertEquals } from "@std/assert";
import {
  collapsePreview,
  COMMENT_COLLAPSE_AT,
  COMMENT_MAX,
} from "@/lib/taskComments";

Deno.test("COMMENT_MAX веба совпадает с серверным пределом (20 000)", () => {
  // Разъедутся — человек получит отказ сервера там, где экран обещал, что влезет.
  assertEquals(COMMENT_MAX, 20_000);
});

Deno.test("collapsePreview: короткий текст не трогаем", () => {
  const short = "Короткий апдейт по задаче";
  assertEquals(collapsePreview(short), short);
});

Deno.test("collapsePreview: длинный режется по концу строки рядом с порогом", () => {
  const head = "строка текста\n".repeat(80); // ~1120 знаков, конец строки близко к порогу
  const text = head + "x".repeat(1000);
  const preview = collapsePreview(text);
  assertEquals(preview.length < text.length, true);
  assertEquals(preview.endsWith("строка текста"), true);
});

Deno.test("collapsePreview: сплошной текст без переносов режется по порогу", () => {
  const text = "я".repeat(5000);
  assertEquals(collapsePreview(text).length, COMMENT_COLLAPSE_AT);
});
