// Права на правку записи из инструментов, где запись может быть и встречей, и заметкой
// (ИИ-инструмент бота `update_entry`). Встреча — по правам встречи (meeting-rights.ts),
// остальное — только автор, как у /entries/:id.
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { entryEditError, isMeetingEntry } from "./entry-edit.ts";

const OWNER = 111;
const PARTICIPANT = 222;
const ADMIN = 333;
const OUTSIDER = 444;

const attendees = [{ email: "participant@example.com" }];
const note = {
  is_private: false,
  owner_id: OWNER,
  group_id: "cee",
  entry_type: "note",
  source: "telegram",
  metadata: {},
};
const meeting = { ...note, entry_type: "meeting", source: "desktop-agent", metadata: { attendees } };
const privateMeeting = { ...meeting, is_private: true };

const owner = { id: OWNER };
const participant = { id: PARTICIPANT, email: "participant@example.com" };
const admin = { id: ADMIN, isAdmin: true };
const outsider = { id: OUTSIDER, email: "outsider@example.com" };

Deno.test("встреча распознаётся по типу или источнику, заметка — нет", () => {
  assertEquals(isMeetingEntry(meeting), true);
  assertEquals(isMeetingEntry({ ...note, entry_type: "transcript" }), true);
  assertEquals(isMeetingEntry({ ...note, source: "read_ai" }), true);
  assertEquals(isMeetingEntry({ ...note, source: "voice" }), true);
  assertEquals(isMeetingEntry(note), false);
});

Deno.test("заметка: правит только автор — ни участник, ни админ, ни посторонний", () => {
  assertEquals(entryEditError("n", note, owner, "cee"), null);
  assertNotEquals(entryEditError("n", note, admin, "cee"), null);
  assertNotEquals(entryEditError("n", note, outsider, "cee"), null);
});

Deno.test("встреча: правят автор, участник, админ; посторонний — нет", () => {
  assertEquals(entryEditError("m", meeting, owner, "cee"), null);
  assertEquals(entryEditError("m", meeting, participant, "cee"), null);
  assertEquals(entryEditError("m", meeting, admin, "cee"), null);
  assertNotEquals(entryEditError("m", meeting, outsider, "cee"), null);
});

Deno.test("смена видимости встречи — права удаления: участнику нельзя, автору и админу можно", () => {
  const opts = { changesPrivacy: true };
  assertNotEquals(entryEditError("m", meeting, participant, "cee", opts), null);
  assertEquals(entryEditError("m", meeting, owner, "cee", opts), null);
  assertEquals(entryEditError("m", meeting, admin, "cee", opts), null);
});

Deno.test("личная встреча: только автор, админ получает «не найдена»", () => {
  assertEquals(entryEditError("m", privateMeeting, owner, "cee"), null);
  assertEquals(
    entryEditError("m", privateMeeting, admin, "cee"),
    entryEditError("m", null, admin, "cee"),
  );
});

Deno.test("чужой воркспейс — «не найдена» и для автора, и для встречи, и для заметки", () => {
  for (const e of [note, meeting]) {
    const other = { ...e, group_id: "other" };
    assertEquals(entryEditError("x", other, owner, "cee"), entryEditError("x", null, owner, "cee"));
  }
});

Deno.test("неизвестный воркспейс зрителя не пропускает", () => {
  assertNotEquals(entryEditError("x", note, owner, ""), null);
  assertNotEquals(entryEditError("x", meeting, owner, undefined), null);
});
