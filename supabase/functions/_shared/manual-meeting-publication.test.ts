import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publishDraftMeeting } from "./meeting-publish.ts";

const sourceId = "00000000-0000-4000-8000-000000000183";
const targetId = "00000000-0000-4000-8000-000000000184";
const entryId = "00000000-0000-4000-8000-000000000185";
const createdId = "00000000-0000-4000-8000-000000000186";

type Result = { data: unknown; error: null };

/** In-memory PostgREST fixture: actual publisher and actual matching/arbitration run unchanged. */
function publicationFixture(manualTarget = false) {
  const mutations: { table: string; operation: string; values: Record<string, unknown> }[] = [];
  const entry = {
    id: entryId,
    group_id: "fixture",
    entry_type: "meeting",
    entry_date: "2026-11-14",
    content: "Synthetic summary",
    source: "desktop-agent",
    is_private: false,
    owner_id: 990183001,
    shared_with: [],
    visible_group_ids: ["fixture"],
    archived_at: null,
    metadata: { title: "Synthetic standup", meeting_id: targetId, identity_key: manualTarget ? "manual:target" : null },
  };
  class Query implements PromiseLike<Result> {
    operation = "select";
    values: Record<string, unknown> = {};
    constructor(readonly table: string) {}
    select(..._args: unknown[]) {
      return this;
    }
    eq(..._args: unknown[]) {
      return this;
    }
    neq(..._args: unknown[]) {
      return this;
    }
    is(..._args: unknown[]) {
      return this;
    }
    in(..._args: unknown[]) {
      return this;
    }
    or(..._args: unknown[]) {
      return this;
    }
    order(..._args: unknown[]) {
      return this;
    }
    limit(..._args: unknown[]) {
      return this;
    }
    insert(values: Record<string, unknown>) {
      this.operation = "insert";
      this.values = values;
      return this;
    }
    update(values: Record<string, unknown>) {
      this.operation = "update";
      this.values = values;
      return this;
    }
    result(single: boolean): Result {
      if (this.operation !== "select") {
        mutations.push({ table: this.table, operation: this.operation, values: this.values });
      }
      let rows: unknown[] = [];
      if (this.table === "entries") rows = [this.operation === "insert" ? { id: createdId, ...this.values } : entry];
      if (this.table === "meetings") {
        rows = [{
          id: this.operation === "update" ? sourceId : targetId,
          started_at: "2026-11-14T08:00:00Z",
          transcript: { segments: [{ text: "Synthetic speech" }] },
          notes_edited_at: null,
        }];
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    single() {
      return Promise.resolve(this.result(true));
    }
    maybeSingle() {
      return this.single();
    }
    then<T = Result, U = never>(
      resolve?: ((value: Result) => T | PromiseLike<T>) | null,
      reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
    ): PromiseLike<T | U> {
      return Promise.resolve(this.result(false)).then(resolve, reject);
    }
  }
  const db = { from: (table: string) => new Query(table) } as unknown as SupabaseClient;
  const meeting = (kind: string) => ({
    id: sourceId,
    group_id: "fixture",
    identity_kind: kind,
    identity_key: `${kind}:synthetic`,
    status: "awaiting_review",
    entry_id: null,
    title: "Synthetic standup",
    started_at: "2026-11-14T08:00:00Z",
    draft_notes_md: "Synthetic summary",
    attendees: [],
    recorders: [{ telegram_id: 990183001 }],
    transcript: { segments: [{ text: "Synthetic speech" }] },
    notes_edited_at: null,
  });
  const options = {
    groupId: "fixture",
    telegramId: 990183001,
    viewerEmail: null,
    isPrivate: false,
    countries: [],
    entryColumns: "*",
    skipModel: true,
  };
  return { db, meeting, options, mutations };
}

Deno.test("manual publish without an explicit merge decision stays a separate record", async () => {
  const fixture = publicationFixture();
  const result = await publishDraftMeeting(fixture.db, fixture.meeting("manual"), fixture.options);
  assertEquals(result.ok, true);
  assertEquals(result.status, 201);
  assertEquals(fixture.mutations.filter((m) => m.table === "entries" && m.operation === "insert").length, 1);
  assertEquals(fixture.mutations.some((m) => m.values.entry_id === entryId), false);
});

Deno.test("the same visible published match still deduplicates a non-manual source", async () => {
  const fixture = publicationFixture();
  const result = await publishDraftMeeting(fixture.db, fixture.meeting("calendar"), fixture.options);
  assertEquals(result.ok, true);
  assertEquals(result.status, 200);
  assertEquals(result.ok && result.entry.duplicate, true);
  assertEquals(fixture.mutations.some((m) => m.values.entry_id === entryId), true);
});

Deno.test("a non-manual publisher cannot silently merge into a separate manual recording", async () => {
  const fixture = publicationFixture(true);
  const result = await publishDraftMeeting(fixture.db, fixture.meeting("calendar"), fixture.options);
  assertEquals(result.ok, true);
  assertEquals(result.status, 201);
  assertEquals(fixture.mutations.some((m) => m.values.entry_id === entryId), false);
});
