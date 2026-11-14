import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  ManualMergeCandidate,
  ManualMergeDecisionInput,
  ManualMergeDecisionResult,
} from "../_shared/manual-meeting-merge-types.ts";
import { type ManualMeetingRow, ManualMergeError, type ManualPairSnapshot } from "../_shared/manual-meeting-merge.ts";
import { corsHeaders } from "./http.ts";
import { INTERNAL_ERROR_MESSAGE } from "./client-error.ts";
import {
  handleManualMeetingMergeRoutes,
  manualMergeErrorResponse,
  type ManualMergeRouteContext,
} from "./manual-meeting-merge-routes.ts";

const SOURCE = "00000000-0000-4000-8000-000000001831";
const TARGET = "00000000-0000-4000-8000-000000001832";
const ENTRY = "00000000-0000-4000-8000-000000001834";
const DECISION = "00000000-0000-4000-8000-000000001833";
const ORIGIN = "https://synthetic-ui.invalid";
const ACTOR = { telegramId: 41, groupId: "synthetic-route-workspace", email: null };
const path = (action: "candidate" | "decision") => `/agent-meetings/${SOURCE}/manual-merge-${action}`;
type Result = { data: unknown; error: { code: string } | null };
type RecordRow = Record<string, unknown>;

/** Typed PostgREST port only: no SDK client, HTTP server, provider or write fallback. */
function fixture(published = false, isPrivate = false, confirmed: boolean | "missing" = true) {
  const source: ManualMeetingRow = {
    id: SOURCE,
    group_id: ACTOR.groupId,
    identity_kind: "manual",
    identity_key: "manual:synthetic-route",
    status: "awaiting_review",
    recorders: [{ telegram_id: ACTOR.telegramId }],
    title: "Synthetic route standup",
    started_at: "2026-11-14T08:00:00Z",
    draft_notes_md: "Synthetic source notes",
    transcript: { segments: [{ text: "Synthetic source speech ".repeat(20) }] },
    entry_id: null,
    notes_edited_at: null,
  };
  const target: ManualMeetingRow = {
    ...source,
    id: TARGET,
    identity_kind: "calendar",
    identity_key: "event:synthetic-route",
    draft_notes_md: "Synthetic target notes",
    transcript: { segments: [{ text: "Short synthetic speech" }] },
  };
  if (published) {
    target.status = "in_base";
    target.entry_id = ENTRY;
  }
  const entry = published
    ? {
      id: ENTRY,
      group_id: ACTOR.groupId,
      is_private: isPrivate,
      owner_id: ACTOR.telegramId,
      shared_with: [],
      archived_at: null,
      source: "desktop-agent",
      content: "Synthetic published notes",
      metadata: {
        title: "Synthetic route standup",
        meeting_id: TARGET,
        ...(confirmed === "missing" ? {} : { confirmed }),
      },
      entry_type: "meeting",
      entry_date: "2026-11-14",
    }
    : null;
  const snapshot: ManualPairSnapshot = {
    source,
    target,
    entry,
    target_key: "m:" + TARGET,
    versions: { source: "11", target: "22", entry: null, private: isPrivate },
    previous: null,
  };
  const originalNotes = [{
    id: "synthetic-note",
    meeting_id: SOURCE,
    author_id: 41,
    offset_sec: 9,
    text: "Synthetic original note",
  }];
  const audit = {
    id: DECISION,
    decision: "merge",
    source_meeting_id: SOURCE,
    target_meeting_id: TARGET,
    target_entry_id: published ? ENTRY : null,
    source_snapshot: { ...source, added_by: "Fictional Source", claim_owner: 41 },
    target_snapshot: { ...target, added_by: "Fictional Target", claim_owner: 41 },
    entry_snapshot: entry,
    source_notes: originalNotes,
    target_notes: [],
  };
  const calls: { name: string; args: RecordRow }[] = [];
  const reads: string[] = [];
  let storageError: string | null = null;
  let decisionError: string | null = null;
  let missing = false;
  let writes = 0;
  let recorderNameCalls = 0;
  class Query {
    private filters: [string, unknown][] = [];
    constructor(private table: "meetings" | "entries" | "manual_meeting_pair_decisions") {}
    select() {
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }
    is(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }
    or() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push([column, values]);
      return this;
    }
    insert(): never {
      writes++;
      throw new Error("Unexpected route write");
    }
    update(): never {
      writes++;
      throw new Error("Unexpected route write");
    }
    delete(): never {
      writes++;
      throw new Error("Unexpected route write");
    }
    result(): Result {
      if (storageError) return { data: null, error: { code: storageError } };
      const rows: RecordRow[] = missing
        ? []
        : this.table === "manual_meeting_pair_decisions"
        ? [audit]
        : this.table === "meetings"
        ? [source, target]
        : entry
        ? [entry]
        : [];
      return {
        data: rows.filter((row) =>
          this.filters.every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : (row[key] ?? null) === value
          )
        ),
        error: null,
      };
    }
    maybeSingle(): Promise<Result> {
      const response = this.result();
      return Promise.resolve({ ...response, data: (response.data as RecordRow[] | null)?.[0] ?? null });
    }
    then<T>(resolve: (response: Result) => T): Promise<T> {
      return Promise.resolve(resolve(this.result()));
    }
  }
  const db = {
    from(table: string) {
      reads.push(table);
      if (table !== "meetings" && table !== "entries" && table !== "manual_meeting_pair_decisions") {
        throw new Error("Unexpected route dependency");
      }
      return new Query(table);
    },
    rpc(name: string, args: RecordRow): Promise<Result> {
      calls.push({ name, args });
      if (name === "manual_meeting_pair_snapshot") return Promise.resolve({ data: snapshot, error: null });
      if (name !== "decide_manual_meeting_pair") throw new Error("Unexpected route RPC");
      return Promise.resolve({
        data: decisionError ? null : {
          id: DECISION,
          decision: args.p_decision,
          source_meeting_id: SOURCE,
          target_meeting_id: TARGET,
          target_entry_id: published ? ENTRY : null,
          repeated: false,
          arbitration: args.p_arbitration,
        },
        error: decisionError ? { code: decisionError } : null,
      });
    },
  } as unknown as SupabaseClient;
  const context: ManualMergeRouteContext = {
    supabase: db,
    origin: ORIGIN,
    actor: ACTOR,
    recorderNames(row) {
      recorderNameCalls++;
      assertEquals(row.id, TARGET);
      return Promise.resolve(["Fictional Recorder"]);
    },
  };
  const input: ManualMergeDecisionInput = {
    target: { kind: published ? "entry" : "meeting", id: published ? ENTRY : TARGET },
    decision: "separate",
    base: "workspace",
    snapshotToken: btoa(JSON.stringify(snapshot.versions)),
  };
  return {
    context,
    source,
    target,
    snapshot,
    calls,
    reads,
    input,
    originalNotes,
    storageError: (code: string) => {
      storageError = code;
    },
    decisionError: (code: string) => {
      decisionError = code;
    },
    missing: () => {
      missing = true;
    },
    counts: () => ({ writes, recorderNameCalls }),
  };
}

function request(method: string, routePath: string, body?: unknown): Request {
  return new Request("https://synthetic-api.invalid" + routePath, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function silentDiagnostic<T>(run: () => T | Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

function responseHeaders(response: Response) {
  assertEquals(response.headers.get("content-type"), "application/json");
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("access-control-allow-origin"), corsHeaders(ORIGIN)["Access-Control-Allow-Origin"]);
}

Deno.test("manual merge route serializes the shared candidate DTO, chosen base and no-store CORS", async () => {
  for (const base of [undefined, "workspace", "personal"] as const) {
    const f = fixture(true, base === "personal");
    const url = path("candidate") + (base ? `?base=${base}` : "");
    const response = await handleManualMeetingMergeRoutes(f.context, request("GET", url), path("candidate"));
    assert(response);
    assertEquals(response.status, 200);
    responseHeaders(response);
    const expected: ManualMergeCandidate = {
      sourceMeetingId: SOURCE,
      base: base ?? "workspace",
      target: {
        kind: "entry",
        id: ENTRY,
        title: f.target.title!,
        startedAt: f.target.started_at!,
        recorderNames: ["Fictional Recorder"],
        inBase: true,
        meetingId: TARGET,
        entryId: ENTRY,
      },
      snapshotToken: f.input.snapshotToken,
      arbitration: { replace: true, reason: "incoming_richer" },
    };
    assertEquals(await response.json(), expected);
    assertEquals(f.calls, [{
      name: "manual_meeting_pair_snapshot",
      args: { p_source: SOURCE, p_target_meeting: null, p_target_entry: ENTRY, p_private: base === "personal" },
    }]);
    assertEquals(f.counts(), { writes: 0, recorderNameCalls: 1 });
  }
});

Deno.test("manual merge route preserves candidate-null and rejects unrelated routes without touching ports", async () => {
  const f = fixture();
  assertEquals(await handleManualMeetingMergeRoutes(f.context, request("GET", "/unrelated"), "/unrelated"), null);
  assertEquals(f.reads, []);
  f.source.identity_kind = "calendar";
  const response = await handleManualMeetingMergeRoutes(
    f.context,
    request("GET", path("candidate")),
    path("candidate"),
  );
  assert(response);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), null);
  responseHeaders(response);
  assertEquals(f.calls, []);
});

Deno.test("manual merge No route serializes the shared decision DTO and takes the actor only from context", async () => {
  const f = fixture(true);
  const response = await handleManualMeetingMergeRoutes(
    f.context,
    request("POST", path("decision"), {
      ...f.input,
      actor: { telegramId: 999, groupId: "ignored-body-workspace" },
      telegramId: 999,
      groupId: "ignored-body-workspace",
    }),
    path("decision"),
  );
  assert(response);
  assertEquals(response.status, 200);
  responseHeaders(response);
  const expected: ManualMergeDecisionResult = {
    id: DECISION,
    decision: "separate",
    sourceMeetingId: SOURCE,
    canonicalMeetingId: null,
    entryId: null,
    repeated: false,
    arbitration: { replace: false, reason: "incoming_richer" },
  };
  assertEquals(await response.json(), expected);
  const atomic = f.calls.filter((call) => call.name === "decide_manual_meeting_pair");
  assertEquals(atomic, [{
    name: "decide_manual_meeting_pair",
    args: {
      p_actor: ACTOR.telegramId,
      p_group: ACTOR.groupId,
      p_source: SOURCE,
      p_target_meeting: null,
      p_target_entry: ENTRY,
      p_private: false,
      p_expected: f.snapshot.versions,
      p_decision: "separate",
      p_replace: true,
      p_arbitration: "incoming_richer",
      p_entry_patch: null,
    },
  }]);
  // Unknown tables/RPCs throw. No prepare, provider, publisher, row update, or insert port was reached.
  assertEquals(f.reads, ["meetings", "entries"]);
  assertEquals(f.counts(), { writes: 0, recorderNameCalls: 0 });
});

Deno.test("manual merge route rejects invalid base, JSON and method before the decision port", async () => {
  const cases = [
    { method: "GET", action: "candidate", suffix: "?base=other", body: undefined, status: 400, code: "INVALID_INPUT" },
    { method: "POST", action: "candidate", suffix: "", body: {}, status: 405, code: undefined },
    { method: "GET", action: "decision", suffix: "", body: undefined, status: 405, code: undefined },
    { method: "POST", action: "decision", suffix: "", body: {}, status: 400, code: "INVALID_INPUT" },
  ] as const;
  for (const test of cases) {
    const f = fixture();
    const routePath = path(test.action);
    const response = await handleManualMeetingMergeRoutes(
      f.context,
      request(test.method, routePath + test.suffix, test.body),
      routePath,
    );
    assert(response);
    assertEquals(response.status, test.status);
    assertEquals((await response.json()).code, test.code);
    responseHeaders(response);
    assertEquals(f.calls, []);
    assertEquals(f.reads, []);
  }
  const f = fixture();
  const response = await handleManualMeetingMergeRoutes(
    f.context,
    new Request("https://synthetic-api.invalid" + path("decision"), {
      method: "POST",
      body: "{",
      headers: { "Content-Type": "application/json" },
    }),
    path("decision"),
  );
  assert(response);
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "INVALID_INPUT", code: "INVALID_INPUT" });
  assertEquals(f.calls, []);
});

Deno.test("manual merge route carries 404, 409 and backend failure codes over the JSON boundary", async () => {
  for (
    const [portCode, status, code] of [
      ["42501", 404, "NOT_FOUND"],
      ["40001", 409, "PAIR_CHANGED"],
      ["55P03", 409, "MEETING_BUSY"],
      ["22P02", 400, "INVALID_INPUT"],
      ["synthetic-unavailable", 500, "MANUAL_MERGE_UNAVAILABLE"],
    ] as const
  ) {
    const f = fixture(true);
    f.decisionError(portCode);
    const response = await silentDiagnostic(() =>
      handleManualMeetingMergeRoutes(
        f.context,
        request("POST", path("decision"), f.input),
        path("decision"),
      )
    );
    assert(response);
    assertEquals(response.status, status);
    const body = await response.text();
    assertEquals(JSON.parse(body), status === 500 ? { error: INTERNAL_ERROR_MESSAGE } : { error: code, code });
    assert(!body.includes("synthetic-unavailable"));
    responseHeaders(response);
  }
  const f = fixture();
  f.missing();
  const response = await handleManualMeetingMergeRoutes(
    f.context,
    request("GET", path("candidate")),
    path("candidate"),
  );
  assert(response);
  assertEquals(response.status, 404);
  assertEquals(await response.json(), { error: "NOT_FOUND", code: "NOT_FOUND" });
});

Deno.test("manual merge error adapter retains structured 401/503 and masks unknown errors", async () => {
  // Session guards run outside this extracted helper: this asserts serialization, not an auth flow.
  for (const [status, code] of [[401, "UNAUTHORIZED"], [503, "PREPARATION_FAILED"]] as const) {
    const response = manualMergeErrorResponse(new ManualMergeError(status, code), ORIGIN);
    assertEquals(response.status, status);
    assertEquals(await response.json(), { error: code, code });
    responseHeaders(response);
  }
  const detail = "Synthetic internal detail must not be serialized";
  const response = await silentDiagnostic(() => manualMergeErrorResponse(new Error(detail), ORIGIN));
  assertEquals(response.status, 500);
  const body = await response.text();
  assertEquals(JSON.parse(body), { error: INTERNAL_ERROR_MESSAGE });
  assert(!body.includes(detail));
  responseHeaders(response);
});

Deno.test("manual merge versions route keeps original DTO fields and literal note provenance", async () => {
  const f = fixture(true);
  const routePath = `/agent-meetings/${SOURCE}/manual-merge-versions/${DECISION}`;
  const response = await handleManualMeetingMergeRoutes(f.context, request("GET", routePath), routePath);
  assert(response);
  assertEquals(response.status, 200);
  responseHeaders(response);
  assertEquals(await response.json(), {
    id: DECISION,
    source: {
      id: SOURCE,
      title: f.source.title,
      startedAt: f.source.started_at,
      content: null,
      summary: f.source.draft_notes_md,
      transcript: f.source.transcript,
      authorId: 41,
      addedBy: "Fictional Source",
      recorders: f.source.recorders,
      notes: f.originalNotes,
    },
    target: {
      id: TARGET,
      title: f.target.title,
      startedAt: f.target.started_at,
      content: null,
      summary: f.target.draft_notes_md,
      transcript: f.target.transcript,
      authorId: 41,
      addedBy: "Fictional Target",
      recorders: f.target.recorders,
      notes: [],
    },
    publishedEntry: {
      id: ENTRY,
      title: "Synthetic route standup",
      startedAt: null,
      content: "Synthetic published notes",
      summary: null,
      transcript: null,
      authorId: 41,
      addedBy: null,
      recorders: null,
      notes: [],
    },
  });
  assert(f.calls.every((call) => call.name === "manual_meeting_pair_snapshot"));
  assertEquals(f.counts(), { writes: 0, recorderNameCalls: 0 });
});

Deno.test("manual merge candidate route distinguishes published entry and underlying meeting IDs", async () => {
  const f = fixture(true);
  const response = await handleManualMeetingMergeRoutes(
    f.context,
    request("GET", path("candidate")),
    path("candidate"),
  );
  assert(response);
  assertEquals(response.status, 200);
  const expected: ManualMergeCandidate = {
    sourceMeetingId: SOURCE,
    base: "workspace",
    target: {
      kind: "entry",
      id: ENTRY,
      title: f.target.title!,
      startedAt: f.target.started_at!,
      recorderNames: ["Fictional Recorder"],
      inBase: true,
      meetingId: TARGET,
      entryId: ENTRY,
    },
    snapshotToken: f.input.snapshotToken,
    arbitration: { replace: true, reason: "incoming_richer" },
  };
  assertEquals(await response.json(), expected);
  assertEquals(f.calls, [{
    name: "manual_meeting_pair_snapshot",
    args: { p_source: SOURCE, p_target_meeting: null, p_target_entry: ENTRY, p_private: false },
  }]);
  assertEquals(f.counts(), { writes: 0, recorderNameCalls: 1 });
});

Deno.test("manual merge route excludes open targets from GET and rejects open Yes before any preparation or write", async () => {
  const f = fixture();
  const get = await handleManualMeetingMergeRoutes(f.context, request("GET", path("candidate")), path("candidate"));
  assert(get);
  assertEquals(get.status, 200);
  assertEquals(await get.json(), null);
  responseHeaders(get);
  assertEquals(f.calls, []);
  const post = await handleManualMeetingMergeRoutes(
    f.context,
    request("POST", path("decision"), {
      ...f.input,
      decision: "merge",
    }),
    path("decision"),
  );
  assert(post);
  assertEquals(post.status, 404);
  assertEquals(await post.json(), { error: "NOT_FOUND", code: "NOT_FOUND" });
  responseHeaders(post);
  assert(f.calls.every((call) => call.name === "manual_meeting_pair_snapshot"));
  assertEquals(f.counts(), { writes: 0, recorderNameCalls: 0 });
});

Deno.test("manual merge route requires a confirmed published meeting entry rather than a linked draft or note", async () => {
  for (
    const invalid of [
      { confirmed: false, entryType: "meeting" },
      { confirmed: "missing", entryType: "meeting" },
      { confirmed: true, entryType: "note" },
    ] as const
  ) {
    const f = fixture(true, false, invalid.confirmed);
    f.snapshot.entry!.entry_type = invalid.entryType;
    const get = await handleManualMeetingMergeRoutes(f.context, request("GET", path("candidate")), path("candidate"));
    assert(get);
    assertEquals(get.status, 200);
    assertEquals(await get.json(), null);
    responseHeaders(get);
    const post = await handleManualMeetingMergeRoutes(
      f.context,
      request("POST", path("decision"), {
        ...f.input,
        decision: "merge",
      }),
      path("decision"),
    );
    assert(post);
    assertEquals(post.status, 404);
    assertEquals(await post.json(), { error: "NOT_FOUND", code: "NOT_FOUND" });
    responseHeaders(post);
    assert(f.calls.every((call) => call.name === "manual_meeting_pair_snapshot"));
    assertEquals(f.counts(), { writes: 0, recorderNameCalls: 0 });
  }
});
