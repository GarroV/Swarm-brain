// deno test --allow-read miniapp/src/lib/agentMeeting.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasDraftNotes, recordedByOf } from "./agentMeeting.ts";

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

Deno.test("recordedByOf: отметка сервера важнее того, кто завёл строку", () => {
  // Строку завёл бот, но его не впустили — в стенограмме запись рекордера.
  assertEquals(recordedByOf({ source: "desktop-agent", agent_version: "scriba-2513", recorded_by: "bumblebee" }), "bumblebee");
  assertEquals(recordedByOf({ source: "desktop-agent", agent_version: "0.1.0", recorded_by: "scriba" }), "scriba");
});

Deno.test("recordedByOf: без отметки — по тому, кто завёл строку", () => {
  assertEquals(recordedByOf({ source: "desktop-agent", agent_version: "scriba-2513" }), "scriba");
  assertEquals(recordedByOf({ source: "desktop-agent", agent_version: "0.1.0", recorded_by: null }), "bumblebee");
  assertEquals(recordedByOf({ source: "swarm-recorder" }), "bumblebee");
});

Deno.test("recordedByOf: встреча не из рекордера и не от бота — null", () => {
  assertEquals(recordedByOf({ source: "granola", recorded_by: "scriba" }), null);
  assertEquals(recordedByOf({ source: null }), null);
});
