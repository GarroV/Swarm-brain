// deno test --allow-read miniapp/src/lib/agentMeeting.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasDraftNotes } from "./agentMeeting.ts";

Deno.test("списочная форма: читаем флаг has_draft_notes", () => {
  assertEquals(hasDraftNotes({ has_draft_notes: true }), true);
  assertEquals(hasDraftNotes({ has_draft_notes: false }), false);
});

Deno.test("детальная форма: флага нет, смотрим на сам текст", () => {
  assertEquals(hasDraftNotes({ draft_notes_md: "### Тезисы" }), true);
  assertEquals(hasDraftNotes({ draft_notes_md: null }), false);
});

Deno.test("пустой текст тезисов — не готово", () => {
  assertEquals(hasDraftNotes({ draft_notes_md: "  \n " }), false);
});

Deno.test("флаг приоритетнее текста: в списке текста нет вовсе", () => {
  // Списочный ответ приходит БЕЗ draft_notes_md — фолбэк на текст дал бы ложное «не готово».
  assertEquals(hasDraftNotes({ has_draft_notes: true, draft_notes_md: undefined }), true);
});

Deno.test("ничего не известно — считаем, что не готово (fail-closed, показываем «готовим…»)", () => {
  assertEquals(hasDraftNotes({}), false);
});
