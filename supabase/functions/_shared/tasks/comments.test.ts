// Запуск: deno test supabase/functions/_shared/tasks/comments.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateCommentContent, COMMENT_MAX } from "./comments.ts";

Deno.test("validateCommentContent: тримит и принимает непустой", () => {
  assertEquals(validateCommentContent("  привет  "), { ok: true, value: "привет" });
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
