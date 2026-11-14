import { assertEquals } from "@std/assert";
import {
  type ContextCandidate,
  type ContextMeeting,
  participantPeople,
  participantRoster,
  previousParticipantMeeting,
  sharesParticipants,
} from "./meeting-participant-context.ts";

const attendee = (email: string) => ({ email });
const current: ContextMeeting = {
  id: "current",
  entryId: "current",
  title: null,
  startsAt: "2026-11-14T10:00:00.000Z",
  countries: [],
  attendees: [attendee("self@example.invalid"), attendee("other@example.invalid")],
};
const candidate = (id: string, overrides: Partial<ContextCandidate> = {}): ContextCandidate => ({
  id,
  title: id,
  date: "2026-11-13",
  startsAt: "2026-11-13T10:00:00.000Z",
  attendees: current.attendees,
  ...overrides,
});
Deno.test("calendar roster excludes self/resources, deduplicates normalized email and keeps name-only legacy identities", () => {
  assertEquals([...participantRoster([
    { email: " SELF@example.invalid " },
    { name: "Ignored", self: true },
    { email: "room@resource.calendar.google.com" },
    { email: "r@example.invalid", resource: true },
    { name: "New display name", email: " OTHER@example.invalid " },
    { email: "other@example.invalid" },
    { name: "  Fictional   Legacy " },
    { name: " " },
  ], "self@example.invalid")], ["other@example.invalid", "fictional legacy"]);
});
Deno.test("self-excluded 1:1 matches previous, empty/self-only does not", () => {
  assertEquals(previousParticipantMeeting([candidate("previous")], current, "self@example.invalid")?.id, "previous");
  assertEquals(
    previousParticipantMeeting(
      [candidate("previous", { attendees: [attendee("self@example.invalid")] })],
      current,
      "self@example.invalid",
    ),
    null,
  );
  assertEquals(sharesParticipants(new Set(), new Set()), false);
});
Deno.test("half threshold rounds odd rosters upward and uses the smaller roster, without dedup time/date restrictions", () => {
  assertEquals(sharesParticipants(new Set(["a", "b", "c"]), new Set(["a", "d", "e", "f"])), false);
  assertEquals(sharesParticipants(new Set(["a", "b", "c"]), new Set(["a", "b", "e", "f"])), true);
  assertEquals(sharesParticipants(new Set(["a", "b"]), new Set(["a", "c", "d", "e"])), true);
});
Deno.test("choose latest actual preceding timestamp, excluding current/future and unprovable same-day legacy rows", () => {
  const rows = [
    candidate("future", { startsAt: "2026-11-14T12:00:00Z", date: "2026-11-14" }),
    candidate("current", { startsAt: "2026-11-14T09:00:00Z" }),
    candidate("same-day-unknown", { startsAt: null, date: "2026-11-14" }),
    candidate("older"),
    candidate("recent", { startsAt: "2026-11-14T08:00:00Z", date: "2026-11-14" }),
  ];
  assertEquals(previousParticipantMeeting(rows, current, "self@example.invalid")?.id, "recent");
  assertEquals(previousParticipantMeeting(rows.slice(0, 3), current, "self@example.invalid"), null);
  assertEquals(
    previousParticipantMeeting([candidate("date-only", { startsAt: null })], current, "self@example.invalid")?.id,
    "date-only",
  );
});
Deno.test("participant task identity uses exact email then current-directory person/account IDs; identical names do not confer identity", () => {
  const people = [{ id: "person", email: "OTHER@example.invalid", telegramId: null }, {
    id: "account",
    email: "self@example.invalid",
    telegramId: 1001,
  }, { id: "unrelated", email: "different@example.invalid", telegramId: 1002 }];
  assertEquals(participantPeople(current.attendees, people), { personIds: ["person", "account"], telegramIds: [1001] });
  assertEquals(participantPeople([{ name: "same name" }], people), { personIds: [], telegramIds: [] });
  assertEquals(participantPeople([{ email: "OTHER@example.invalid", resource: true }], people), {
    personIds: [],
    telegramIds: [],
  });
});
