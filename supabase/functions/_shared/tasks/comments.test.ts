// Запуск: deno test supabase/functions/_shared/tasks/comments.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { COMMENT_MAX, commentDeleteDenial, validateCommentContent } from "./comments.ts";

Deno.test("validateCommentContent: тримит и принимает непустой", () => {
  assertEquals(validateCommentContent("  привет  "), {
    ok: true,
    value: "привет",
  });
});

Deno.test("validateCommentContent: пустой/пробелы/не строка → ошибка", () => {
  assertEquals(validateCommentContent("").ok, false);
  assertEquals(validateCommentContent("   ").ok, false);
  assertEquals(validateCommentContent(null).ok, false);
  assertEquals(validateCommentContent(123).ok, false);
});

Deno.test("validateCommentContent: длиннее лимита → ошибка", () => {
  const long = "a".repeat(COMMENT_MAX + 1);
  assertEquals(validateCommentContent(long).ok, false);
  assertEquals(validateCommentContent("a".repeat(COMMENT_MAX)).ok, true);
});

// Предел — договорённость с владельцем (22.09.2026, issue #445), а не деталь реализации:
// тест выше параметризован COMMENT_MAX и остаётся зелёным при любом значении, поэтому
// фиксируем само число — иначе оно уедет молча.
Deno.test("COMMENT_MAX: предел — 20 000 знаков", () => {
  assertEquals(COMMENT_MAX, 20_000);
});

Deno.test("validateCommentContent: длинный пост (10 000 знаков) проходит", () => {
  // Ровно тот сценарий, из-за которого предел поднимали: вставить целиком большой текст.
  assertEquals(validateCommentContent("я".repeat(10_000)).ok, true);
});

Deno.test("validateCommentContent: отказ называет фактическую длину и предел", () => {
  const res = validateCommentContent("a".repeat(COMMENT_MAX + 7));
  assertEquals(res.ok, false);
  const error = (res as { ok: false; error: string }).error;
  assertEquals(error.includes(String(COMMENT_MAX + 7)), true);
  assertEquals(error.includes(String(COMMENT_MAX)), true);
});

Deno.test("commentDeleteDenial: автор удаляет свой комментарий", () => {
  assertEquals(commentDeleteDenial(42, 42, false), null);
});

Deno.test("commentDeleteDenial: чужой без админского обхода — отказ", () => {
  assertEquals(commentDeleteDenial(7, 42, false), "Нельзя удалить чужой комментарий");
});

Deno.test("commentDeleteDenial: комментарий без автора без обхода — отказ", () => {
  assertEquals(commentDeleteDenial(null, 42, false), "Нельзя удалить чужой комментарий");
});

Deno.test("commentDeleteDenial: админский обход пропускает чужой", () => {
  assertEquals(commentDeleteDenial(7, 42, true), null);
});
