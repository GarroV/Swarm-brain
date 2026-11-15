import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMeetingLiveNotes } from "./meeting-live-notes-routes.ts";

const root = "00000000-0000-4000-8000-000000001831";
const source = "00000000-0000-4000-8000-000000001832";
const unavailable = "00000000-0000-4000-8000-000000001833";

Deno.test("draft notes preserve each visible original's author, ID and unrebased recording offset", async () => {
  const originals = [
    { id: root, group_id: "fixture", recorders: [{ telegram_id: 1 }], started_at: "2026-11-14T08:00:00Z" },
    { id: source, group_id: "fixture", co_owners: [1], started_at: "2026-11-14T08:05:00Z" },
    { id: unavailable, group_id: "fixture", recorders: [{ telegram_id: 2 }], started_at: "2026-11-14T08:10:00Z" },
  ];
  const notes = [
    { id: "root-note", meeting_id: root, offset_sec: 7, text: "Synthetic root", author_id: 1 },
    { id: "source-note", meeting_id: source, offset_sec: 9, text: "Synthetic source", author_id: 2 },
    { id: "unavailable-note", meeting_id: unavailable, offset_sec: 1, text: "Unavailable", author_id: 2 },
  ];
  let writes = 0;
  const db = {
    rpc() {
      return Promise.resolve({ data: [root, source, unavailable], error: null });
    },
    from(table: string) {
      let id: unknown;
      let included: string[] = [];
      const q = {
        select() {
          return q;
        },
        eq(_column: string, value: unknown) {
          id = value;
          return q;
        },
        in(_column: string, values: string[]) {
          included = values;
          return q;
        },
        order() {
          return q;
        },
        insert() {
          writes++;
          throw new Error("Unexpected write");
        },
        maybeSingle() {
          return Promise.resolve({ data: originals.find((r) => r.id === id) ?? null, error: null });
        },
        then<T>(resolve: (r: { data: unknown; error: null }) => T) {
          if (table !== "meeting_live_notes") throw new Error("Unexpected list");
          return Promise.resolve(resolve({ data: notes.filter((n) => included.includes(n.meeting_id)), error: null }));
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const response = await handleMeetingLiveNotes({
    supabase: db,
    req: new Request("https://fixture.invalid/agent-meetings/" + root + "/notes"),
    origin: "",
    meetingId: root,
    groupId: "fixture",
    telegramId: 1,
    resolveNames: () => Promise.resolve(new Map([[1, "Synthetic One"], [2, "Synthetic Two"]])),
    serverError: () => {
      throw new Error("Unexpected error path");
    },
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), [
    { ...notes[0], author_name: "Synthetic One", recording_started_at: originals[0].started_at },
    { ...notes[1], author_name: "Synthetic Two", recording_started_at: originals[1].started_at },
  ]);
  assertEquals(writes, 0);
});
