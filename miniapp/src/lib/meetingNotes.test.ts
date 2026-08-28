// Запуск: npm test (deno test -A --no-check src/lib/)
import { assertEquals } from "jsr:@std/assert@1";
import { groupNotesByAuthor } from "./meetingNotes.ts";

const note = (id: string, offset: number, author_id: number, author_name: string | null, text = "…") =>
  ({ id, offset_sec: offset, text, author_id, author_name, created_at: "2026-08-26T12:00:00+00:00" });

Deno.test("группирует по автору, авторы — в порядке первой пометки", () => {
  const rows = [
    note("3", 300, 1002, "Indira"),
    note("1", 60, 1001, "Vasiliy"),
    note("4", 400, 1001, "Vasiliy"),
    note("2", 120, 1002, "Indira"),
  ];
  const grouped = groupNotesByAuthor(rows);
  assertEquals(grouped.map(([a]) => a), ["Vasiliy", "Indira"]);
  assertEquals(grouped[0][1].map((n) => n.id), ["1", "4"]);
  assertEquals(grouped[1][1].map((n) => n.id), ["2", "3"]);
});

Deno.test("без имени автор не теряется — остаётся #id", () => {
  const grouped = groupNotesByAuthor([note("1", 10, 777, null)]);
  assertEquals(grouped.map(([a]) => a), ["#777"]);
});

Deno.test("пустой список — пустая группировка", () => {
  assertEquals(groupNotesByAuthor([]), []);
});

Deno.test("пометки одного автора с одинаковым таймкодом не теряются", () => {
  const grouped = groupNotesByAuthor([note("a", 90, 1, "X"), note("b", 90, 1, "X")]);
  assertEquals(grouped.length, 1);
  assertEquals(grouped[0][1].length, 2);
});
