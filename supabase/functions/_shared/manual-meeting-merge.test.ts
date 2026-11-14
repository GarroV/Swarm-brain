import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOT_PROFILE } from "./bot-profile.ts";
import {
  decideManualMerge,
  getManualMergeCandidate,
  ManualMergeError,
  type ManualPairSnapshot,
  parseManualMergeInput,
  readManualMergeVersions,
} from "./manual-meeting-merge.ts";

const sid = "00000000-0000-4000-8000-000000000183";
const tid = "00000000-0000-4000-8000-000000000184";
const eid = "00000000-0000-4000-8000-000000000185";
const actor = { telegramId: 1, groupId: "fixture", email: null };

function fixture(published = true) {
  const source = {
    id: sid,
    group_id: "fixture",
    identity_kind: "manual",
    identity_key: "manual:fixture",
    status: "awaiting_review",
    recorders: [{ telegram_id: 1 }],
    draft_notes_md: "Synthetic source notes",
    title: "Synthetic standup",
    started_at: "2026-11-14T08:00:00Z",
    transcript: { segments: [{ text: "Synthetic speech ".repeat(20) }] },
    entry_id: null,
    notes_edited_at: null,
  };
  const target = {
    ...source,
    id: tid,
    identity_kind: "calendar",
    identity_key: "event:fixture",
    co_owners: [2],
    status: published ? "in_base" : "awaiting_review",
    entry_id: published ? eid : null,
    draft_notes_md: "Synthetic target notes",
    transcript: { segments: [{ text: "Short speech" }] },
  };
  const entry = published
    ? {
      id: eid,
      group_id: "fixture",
      is_private: false,
      owner_id: 1,
      shared_with: [],
      archived_at: null as string | null,
      source: "desktop-agent",
      content: "Synthetic target notes",
      metadata: { title: "Synthetic standup", meeting_id: tid },
    }
    : null;
  const snapshot = {
    source,
    target,
    entry,
    target_key: "m:" + tid,
    versions: {
      source_id: sid,
      target_id: tid,
      entry_id: published ? eid : null,
      source: "1",
      target: "2",
      entry: published ? "3" : null,
      members: "fixture-versions",
      private: false,
    },
    previous: null,
  } as ManualPairSnapshot;
  const atomic: Record<string, unknown>[] = [];
  const removed = new Set<string>();
  const audit = {
    id: "00000000-0000-4000-8000-000000000186",
    decision: "merge",
    source_meeting_id: sid,
    target_meeting_id: tid,
    target_entry_id: published ? eid : null,
    source_snapshot: { ...source, transcript: structuredClone(source.transcript) },
    target_snapshot: { ...target, transcript: structuredClone(target.transcript) },
    entry_snapshot: entry ? { ...entry } : null,
    source_notes: [{ id: "source-note", author_id: 1, meeting_id: sid, offset_sec: 9, text: "Source original note" }],
    target_notes: [{ id: "target-note", author_id: 2, meeting_id: tid, offset_sec: 7, text: "Target original note" }],
  };
  let atomicError: string | null = null;
  class Query {
    id: string | null = null;
    constructor(readonly table: string) {}
    select(..._args: unknown[]) {
      return this;
    }
    eq(column: string, value: unknown) {
      if (column === "id") this.id = String(value);
      return this;
    }
    is(..._args: unknown[]) {
      return this;
    }
    or(..._args: unknown[]) {
      return this;
    }
    in(..._args: unknown[]) {
      return this;
    }
    order(..._args: unknown[]) {
      return this;
    }
    limit(..._args: unknown[]) {
      return this;
    }
    data() {
      if (this.table === "manual_meeting_pair_decisions") return [audit];
      return (this.table === "entries" ? (entry ? [entry] : []) : [snapshot.source, snapshot.target])
        .filter((row) => row != null && !removed.has(row.id));
    }
    maybeSingle() {
      return Promise.resolve({ data: this.data().find((row) => row?.id === this.id) ?? null, error: null });
    }
    then<T>(resolve: (value: { data: unknown; error: null }) => T) {
      return Promise.resolve(resolve({ data: this.data(), error: null }));
    }
  }
  const db = {
    from: (table: string) => new Query(table),
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "manual_meeting_pair_snapshot") return Promise.resolve({ data: snapshot, error: null });
      if (name !== "decide_manual_meeting_pair") throw new Error("Unexpected fixture RPC");
      atomic.push(args);
      return Promise.resolve({
        data: atomicError ? null : snapshot.previous ? { ...snapshot.previous, repeated: true } : {
          id: "00000000-0000-4000-8000-000000000186",
          decision: args.p_decision,
          source_meeting_id: sid,
          target_meeting_id: tid,
          target_entry_id: published ? eid : null,
          arbitration: args.p_arbitration,
          active: true,
          repeated: false,
        },
        error: atomicError ? { code: atomicError } : null,
      });
    },
  } as unknown as SupabaseClient;
  const input = (decision: "merge" | "separate" = "merge") =>
    parseManualMergeInput({
      target: { kind: published ? "entry" : "meeting", id: published ? eid : tid },
      decision,
      base: "workspace",
      snapshotToken: btoa(JSON.stringify(snapshot.versions)),
    });
  return {
    db,
    source,
    target,
    entry,
    snapshot,
    atomic,
    removed,
    audit,
    input,
    error: (code: string) => {
      atomicError = code;
    },
  };
}

Deno.test("candidate GET is read-only and binds both IDs, versions and chosen storage", async () => {
  const f = fixture();
  const candidate = await getManualMergeCandidate(
    f.db,
    sid,
    "workspace",
    actor,
    () => Promise.resolve(["Synthetic recorder"]),
  );
  assertEquals(candidate?.target.id, eid);
  assertEquals(candidate?.target.recorderNames, ["Synthetic recorder"]);
  assertEquals(JSON.parse(atob(candidate!.snapshotToken)), f.snapshot.versions);
  assertEquals(f.atomic.length, 0);
});

Deno.test("No never prepares content and passes the exact pair snapshot to the single atomic operation", async () => {
  const f = fixture(true);
  let prepared = 0;
  const result = await decideManualMerge(f.db, sid, f.input("separate"), actor, () => {
    prepared++;
    throw new Error("No must not prepare");
  });
  assertEquals(result.decision, "separate");
  assertEquals(result.canonicalMeetingId, null);
  assertEquals(result.entryId, null);
  assertEquals(prepared, 0);
  assertEquals(f.atomic.length, 1);
  assertEquals(f.atomic[0].p_expected, f.snapshot.versions);
  assertEquals(f.atomic[0].p_entry_patch, null);
});

Deno.test("a stale token cannot trigger model preparation or an atomic mutation", async () => {
  const f = fixture(true);
  const input = f.input();
  f.snapshot.versions.target = "changed";
  await assertRejects(() => decideManualMerge(f.db, sid, input, actor), ManualMergeError, "PAIR_CHANGED");
  assertEquals(f.atomic.length, 0);
});

Deno.test("an actual live bot heartbeat remains busy even when the stored target is published", async () => {
  const f = fixture();
  Object.assign(f.snapshot.target!, {
    agent_version: `${BOT_PROFILE.name}-fixture`,
    agent_last_recording: true,
    agent_last_seen_at: new Date().toISOString(),
    summary_status: null,
    has_draft_notes: false,
  });
  assertEquals(await getManualMergeCandidate(f.db, sid, "workspace", actor), null);
  await assertRejects(
    () =>
      decideManualMerge(
        f.db,
        sid,
        f.input(),
        actor,
        () => Promise.resolve({ content: "Prepared", summary: "Prepared", embedding: null, metadata: {} }),
      ),
    ManualMergeError,
    "MEETING_BUSY",
  );
  assertEquals(f.atomic.length, 0);
});

Deno.test("a readable foreign-owned entry is refused before prepare/commit", async () => {
  const f = fixture(true);
  f.snapshot.entry!.owner_id = 2;
  await assertRejects(() => decideManualMerge(f.db, sid, f.input(), actor), ManualMergeError, "NOT_FOUND");
  assertEquals(f.atomic.length, 0);
});

Deno.test("content preparation failure does not record Yes or change either meeting", async () => {
  const f = fixture(true);
  await assertRejects(
    () => decideManualMerge(f.db, sid, f.input(), actor, () => Promise.reject(new Error("Synthetic failure"))),
    ManualMergeError,
    "PREPARATION_FAILED",
  );
  assertEquals(f.atomic.length, 0);
});

Deno.test("NOWAIT/storage conflicts are retryable409 rather than a false merge receipt", async () => {
  const f = fixture();
  f.error("55P03");
  await assertRejects(
    () =>
      decideManualMerge(
        f.db,
        sid,
        f.input(),
        actor,
        () => Promise.resolve({ content: "Prepared", summary: "Prepared", embedding: null, metadata: {} }),
      ),
    ManualMergeError,
    "MEETING_BUSY",
  );
  assertEquals(f.atomic.length, 1);
});

Deno.test("an identical completed decision returns its original arbitration without re-preparing content", async () => {
  const f = fixture(true);
  f.snapshot.previous = {
    id: "saved",
    decision: "merge",
    active: true,
    source_meeting_id: sid,
    target_meeting_id: tid,
    target_entry_id: eid,
    arbitration: "incoming_richer",
  };
  f.snapshot.target!.transcript = f.source.transcript;
  let prepared = 0;
  const result = await decideManualMerge(f.db, sid, f.input(), actor, () => {
    prepared++;
    throw new Error("Repeat must not prepare");
  });
  assertEquals(result.repeated, true);
  assertEquals(result.arbitration, { replace: true, reason: "incoming_richer" });
  assertEquals(prepared, 0);
});

Deno.test("request parsing cannot accept an actor or content override as mutation authority", () => {
  const f = fixture();
  const input = parseManualMergeInput({ ...f.input(), actorId: 2, p_replace: true, content: "Untrusted override" });
  assertEquals(Object.keys(input).sort(), ["base", "decision", "snapshotToken", "target"]);
});

Deno.test("open targets are not proposed before a safe existing finalization state exists", async () => {
  const f = fixture(false);
  assertEquals(await getManualMergeCandidate(f.db, sid, "workspace", actor), null);
});

Deno.test("a direct open-target decision cannot bypass the published-only eligible subset", async () => {
  for (const decision of ["merge", "separate"] as const) {
    const f = fixture(false);
    await assertRejects(() => decideManualMerge(f.db, sid, f.input(decision), actor), ManualMergeError, "NOT_FOUND");
    assertEquals(f.atomic.length, 0);
  }
});

Deno.test("a stored queued upload is busy without preparing content or recording a decision", async () => {
  const f = fixture();
  f.snapshot.versions.queued = true;
  assertEquals(await getManualMergeCandidate(f.db, sid, "workspace", actor), null);
  let prepared = 0;
  await assertRejects(
    () =>
      decideManualMerge(f.db, sid, f.input(), actor, () => {
        prepared++;
        return Promise.resolve({ content: "Prepared", summary: "Prepared", embedding: null, metadata: {} });
      }),
    ManualMergeError,
    "MEETING_BUSY",
  );
  assertEquals(prepared, 0);
  assertEquals(f.atomic.length, 0);
});

Deno.test("history returns both immutable originals and original note attribution instead of the winning current content", async () => {
  const f = fixture();
  f.target.draft_notes_md = "Current winning content";
  const result = await readManualMergeVersions(f.db, sid, f.audit.id, actor);
  assertEquals(result.source.id, sid);
  assertEquals(result.source.summary, "Synthetic source notes");
  assertEquals(result.target.id, tid);
  assertEquals(result.target.summary, "Synthetic target notes");
  assertEquals(result.source.notes, f.audit.source_notes);
  assertEquals(result.target.notes, f.audit.target_notes);
  assertEquals("group_id" in result.source, false);
  assertEquals(f.atomic.length, 0);
});

Deno.test("explicitly deleted source or target never becomes readable through immutable history", async () => {
  for (const id of [sid, tid]) {
    const f = fixture();
    f.removed.add(id);
    await assertRejects(() => readManualMergeVersions(f.db, sid, f.audit.id, actor), ManualMergeError, "NOT_FOUND");
    assertEquals(f.atomic.length, 0);
  }
});

Deno.test("archived published original and another source's history retain the old404 contract", async () => {
  const f = fixture(true);
  f.entry!.archived_at = "2026-11-14T09:00:00Z";
  await assertRejects(() => readManualMergeVersions(f.db, sid, f.audit.id, actor), ManualMergeError, "NOT_FOUND");
  const other = fixture();
  await assertRejects(
    () => readManualMergeVersions(other.db, tid, other.audit.id, actor),
    ManualMergeError,
    "NOT_FOUND",
  );
});
