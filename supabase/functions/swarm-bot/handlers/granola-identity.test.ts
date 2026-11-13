import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { granolaIdentity, granolaImportStartedAt } from "./granola-identity.ts";

const content = "Дата: 11.11.2026, 13:22\n\nУчастники: Rendered Name\n\nСаммари: Notes";
const attendees = [{ name: "Surname, Given", email: "Person@example.test" }, { email: "Second@example.test" }];

Deno.test("Granola: structured attendees retain names and e-mail instead of formatted text", () => {
  assertEquals(granolaIdentity({ attendees }, content).attendees, attendees);
});

Deno.test("Granola: structured empty attendance is authoritative", () => {
  assertEquals(granolaIdentity({ attendees: [] }, content).attendees, []);
});

Deno.test("Granola: calendar start retains the actual instant, including timezone", () => {
  const got = granolaIdentity({ calendar_event: { scheduled_start_time: "2026-11-12T00:30:00+02:00" } }, content);
  assertEquals(got.startedAt, "2026-11-11T22:30:00.000Z");
  assertEquals(got.entryDate, "2026-11-11");
  assertEquals(got.startTime, "22:30");
});

Deno.test("Granola: preview cache round-trip preserves structured identity", () => {
  const first = granolaIdentity(
    { attendees, calendar_event: { scheduled_start_time: "2026-11-11T12:22:00Z" } },
    content,
  );
  const cache = JSON.parse(JSON.stringify({ attendees: first.attendees, startedAt: first.startedAt }));
  assertEquals(granolaIdentity(cache, "Дата: 01.01.2020, 00:00\nУчастники: Wrong"), first);
});

Deno.test("Granola: old previews without structured fields still parse rendered content", () => {
  assertEquals(granolaIdentity({}, content), {
    attendees: [{ name: "rendered name" }],
    startedAt: "2026-11-11T13:22:00",
    entryDate: "2026-11-11",
    startTime: "13:22",
  });
});

Deno.test("Granola: invalid date does not invent a timestamp", () => {
  assertEquals(granolaIdentity({ calendar_event: { scheduled_start_time: "not a date" } }, "").startedAt, null);
});

Deno.test("Granola: invalid source is compatible with legacy content", () => {
  assertEquals(granolaIdentity(null, content), granolaIdentity({}, content));
});

Deno.test("Granola: metadata extraction does not mutate the source", () => {
  const source = { attendees, calendar_event: { scheduled_start_time: "2026-11-11T12:22:00Z" } };
  const before = JSON.stringify(source);
  granolaIdentity(source, content);
  assertEquals(JSON.stringify(source), before);
});

Deno.test("Granola: legacy preview round-trip never reinterprets a local timestamp as a source instant", () => {
  const first = granolaIdentity({}, content);
  const cached = JSON.parse(JSON.stringify({ attendees: first.attendees, startedAt: first.startedAt }));
  assertEquals(granolaIdentity(cached, content), first);
});

Deno.test("Granola: automatic import without calendar preserves created_at seconds over text fallback", () => {
  const identity = granolaIdentity({}, content);
  assertEquals(
    granolaImportStartedAt(identity, { created_at: "2026-11-11T12:22:42.123Z" }),
    "2026-11-11T12:22:42.123Z",
  );
});

Deno.test("Granola: full-detail calendar takes precedence over list creation time", () => {
  const identity = granolaIdentity({ calendar_event: { scheduled_start_time: "2026-11-11T13:22:00+01:00" } }, content);
  assertEquals(granolaImportStartedAt(identity, { created_at: "2026-11-12T02:12:00Z" }), "2026-11-11T12:22:00.000Z");
});
