import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canAccessDraftMeeting } from "./meeting-access.ts";
import { canViewEntry, type EntryAccessRow } from "./entries/access.ts";
import { meetingEntryIsLive } from "./meeting-entry-live.ts";
import { isBotRecordingNow, type SlotRow } from "./bot-slot.ts";
import { arbitrateFullness, type TranscriptLike } from "./meeting-fullness.ts";
import { type Candidate, type DedupIncoming, findDuplicateMeeting, meetingCandidateMatcher } from "./meeting-dedup.ts";
import { manualPairAllowed, manualPairBusy, type ManualPairMeeting } from "./manual-meeting-pair.ts";
import { buildEmbeddingInput, embed } from "./meta-extract.ts";
import { openAIKeyHandle } from "./workspace-keys.ts";
import type {
  ManualMergeArbitration,
  ManualMergeBase,
  ManualMergeCandidate,
  ManualMergeDecisionInput,
  ManualMergeDecisionResult,
  ManualMergeTarget,
} from "./manual-meeting-merge-types.ts";

export type ManualMergeActor = { telegramId: number; groupId: string; email?: string | null; isDemo?: boolean };
export type ManualMeetingRow = ManualPairMeeting & Record<string, unknown> & {
  title?: string | null;
  started_at?: string | null;
  transcript?: TranscriptLike;
  notes_edited_at?: string | null;
};
export type ManualMergeEntry = EntryAccessRow & Record<string, unknown> & {
  id: string;
  group_id: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown> | null;
};
type StoredDecision = {
  id: string;
  decision: "merge" | "separate";
  active: boolean;
  source_meeting_id: string;
  target_meeting_id: string | null;
  target_entry_id: string | null;
  arbitration: ManualMergeArbitration["reason"] | null;
  repeated?: boolean;
};
export type ManualPairSnapshot = {
  source: ManualMeetingRow;
  target: ManualMeetingRow | null;
  entry: ManualMergeEntry | null;
  target_key: string;
  versions: Record<string, string | boolean | null>;
  previous: StoredDecision | null;
};
type EntryPatch = { content: string; summary: string; embedding: number[] | null; metadata: Record<string, unknown> };
export type PrepareManualEntry = (
  snapshot: ManualPairSnapshot,
  actor: ManualMergeActor,
  arbitration: ManualMergeArbitration,
) => Promise<EntryPatch>;

export class ManualMergeError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function rpcFailure(error: { code?: string } | null): never {
  if (error?.code === "40001" || error?.code === "23505") throw new ManualMergeError(409, "PAIR_CHANGED");
  if (["55P03", "55000", "54000"].includes(error?.code ?? "")) throw new ManualMergeError(409, "MEETING_BUSY");
  if (error?.code === "42501") throw new ManualMergeError(404, "NOT_FOUND");
  if (["22023", "22P02"].includes(error?.code ?? "")) throw new ManualMergeError(400, "INVALID_INPUT");
  throw new ManualMergeError(500, "MANUAL_MERGE_UNAVAILABLE");
}

const targetArgs = (target: ManualMergeTarget) => ({
  p_target_meeting: target.kind === "meeting" ? target.id : null,
  p_target_entry: target.kind === "entry" ? target.id : null,
});

export async function loadManualMeeting(
  supabase: SupabaseClient,
  id: string,
  actor: ManualMergeActor,
): Promise<ManualMeetingRow> {
  const { data, error } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
  if (error) throw new ManualMergeError(500, "MANUAL_MERGE_UNAVAILABLE");
  const row = data as ManualMeetingRow | null;
  if (
    !row || !canAccessDraftMeeting(row, actor.telegramId, false, actor.groupId, actor.email) ||
    !await meetingEntryIsLive(supabase, row)
  ) {
    throw new ManualMergeError(404, "NOT_FOUND");
  }
  return row;
}

/** Resolve a confirmed source alias without changing either row's existing authority. DELETE does not use this. */
export async function canonicalManualMeeting(
  supabase: SupabaseClient,
  row: ManualMeetingRow,
  actor: ManualMergeActor,
): Promise<ManualMeetingRow> {
  const seen = new Set<string>();
  let current = row;
  while (current.manual_merge_target_id) {
    if (seen.has(current.id) || seen.size >= 64) throw new ManualMergeError(409, "MEETING_BUSY");
    seen.add(current.id);
    current = await loadManualMeeting(supabase, current.manual_merge_target_id, actor);
  }
  return current;
}

export async function manualMeetingGroupIds(supabase: SupabaseClient, roots: string[]): Promise<string[]> {
  const validRoots = roots.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (!validRoots.length) return [];
  const { data, error } = await supabase.rpc("manual_meeting_group_members", { p_roots: validRoots });
  if (error) rpcFailure(error);
  return (data ?? []) as string[];
}

export async function getManualPairSnapshot(
  supabase: SupabaseClient,
  sourceId: string,
  target: ManualMergeTarget,
  base: ManualMergeBase,
  actor: ManualMergeActor,
): Promise<ManualPairSnapshot> {
  await loadManualMeeting(supabase, sourceId, actor);
  const { data, error } = await supabase.rpc("manual_meeting_pair_snapshot", {
    p_source: sourceId,
    ...targetArgs(target),
    p_private: base === "personal",
  });
  if (error) rpcFailure(error);
  const snapshot = data as ManualPairSnapshot | null;
  if (
    !snapshot ||
    !manualPairAllowed(
      snapshot.source,
      snapshot.target,
      snapshot.entry,
      actor.telegramId,
      actor.groupId,
      base === "personal",
    )
  ) {
    throw new ManualMergeError(404, "NOT_FOUND");
  }
  if (
    !await meetingEntryIsLive(supabase, snapshot.source) ||
    (snapshot.target && !await meetingEntryIsLive(supabase, snapshot.target))
  ) throw new ManualMergeError(404, "NOT_FOUND");
  return snapshot;
}

const incoming = (source: ManualMeetingRow, actor: ManualMergeActor, base: ManualMergeBase): DedupIncoming => ({
  groupId: actor.groupId,
  entryDate: source.started_at?.split("T")[0] ?? null,
  startedAt: source.started_at,
  title: source.title,
  attendees: (source.attendees ?? []) as DedupIncoming["attendees"],
  identityKey: typeof source.identity_key === "string" ? source.identity_key : null,
  viewerEmail: actor.email ?? null,
  viewerId: actor.telegramId,
  publishPrivate: base === "personal",
  allowManualCandidates: true,
  requireMutation: true,
});

function projectedCandidate(snapshot: ManualPairSnapshot): Candidate {
  if (snapshot.entry) return snapshot.entry as unknown as Candidate;
  const target = snapshot.target!;
  return {
    id: target.id,
    content: target.draft_notes_md ?? "",
    source: typeof target.source === "string" ? target.source : null,
    is_private: false,
    owner_id: null,
    shared_with: [],
    metadata: {
      title: target.title ?? undefined,
      identity_key: typeof target.identity_key === "string" ? target.identity_key : undefined,
      attendees: (target.attendees ?? []) as DedupIncoming["attendees"],
    },
  };
}

const arbitrationOf = (snapshot: ManualPairSnapshot): ManualMergeArbitration =>
  arbitrateFullness(
    { transcript: snapshot.source.transcript ?? null, notesEditedAt: snapshot.source.notes_edited_at },
    { transcript: snapshot.target?.transcript ?? null, notesEditedAt: snapshot.target?.notes_edited_at },
  );

function busy(snapshot: ManualPairSnapshot): boolean {
  return snapshot.versions.queued === true || manualPairBusy(snapshot.source, snapshot.target) ||
    isBotRecordingNow(snapshot.source as unknown as SlotRow) ||
    (!!snapshot.target && isBotRecordingNow(snapshot.target as unknown as SlotRow));
}

function snapshotMatches(snapshot: ManualPairSnapshot, actor: ManualMergeActor, base: ManualMergeBase): boolean {
  return meetingCandidateMatcher(incoming(snapshot.source, actor, base))(
    projectedCandidate(snapshot),
    snapshot.target?.started_at,
  );
}

export async function getManualMergeCandidate(
  supabase: SupabaseClient,
  sourceId: string,
  base: ManualMergeBase,
  actor: ManualMergeActor,
  recorderNames: (row: ManualMeetingRow) => Promise<string[]> = () => Promise.resolve([]),
): Promise<ManualMergeCandidate | null> {
  const source = await loadManualMeeting(supabase, sourceId, actor);
  if (source.identity_kind !== "manual" || manualPairBusy(source, null)) return null;
  const inc = incoming(source, actor, base);
  if (!inc.entryDate) return null;
  const published = await findDuplicateMeeting(supabase, inc);
  const candidates: ManualMergeTarget[] = published ? [{ kind: "entry", id: published.id }] : [];
  for (const target of candidates) {
    let snapshot: ManualPairSnapshot;
    try {
      snapshot = await getManualPairSnapshot(supabase, sourceId, target, base, actor);
    } catch (e) {
      if (e instanceof ManualMergeError && e.status === 404) continue;
      throw e;
    }
    if (snapshot.previous || busy(snapshot) || !snapshotMatches(snapshot, actor, base)) continue;
    const targetRow = snapshot.target;
    return {
      sourceMeetingId: sourceId,
      base,
      target: {
        ...target,
        title: targetRow?.title ?? (snapshot.entry?.metadata?.title as string | undefined) ?? "",
        startedAt: targetRow?.started_at ?? null,
        recorderNames: targetRow ? await recorderNames(targetRow) : [],
        inBase: snapshot.entry != null,
        meetingId: targetRow?.id ?? null,
        entryId: snapshot.entry?.id ?? null,
      },
      snapshotToken: btoa(JSON.stringify(snapshot.versions)),
      arbitration: arbitrationOf(snapshot),
    };
  }
  return null;
}

export function parseManualMergeInput(value: unknown): ManualMergeDecisionInput {
  if (!value || typeof value !== "object") throw new ManualMergeError(400, "INVALID_INPUT");
  const body = value as Partial<ManualMergeDecisionInput>;
  if (
    !body.target || !["meeting", "entry"].includes(body.target.kind) ||
    typeof body.target.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.target.id) ||
    !["merge", "separate"].includes(body.decision ?? "") || !["workspace", "personal"].includes(body.base ?? "") ||
    typeof body.snapshotToken !== "string" || body.snapshotToken.length > 2048
  ) throw new ManualMergeError(400, "INVALID_INPUT");
  return {
    target: { kind: body.target.kind, id: body.target.id },
    decision: body.decision!,
    base: body.base!,
    snapshotToken: body.snapshotToken,
  };
}

async function prepareEntry(
  snapshot: ManualPairSnapshot,
  actor: ManualMergeActor,
  arbitration: ManualMergeArbitration,
  supabase: SupabaseClient,
): Promise<EntryPatch> {
  const draft = snapshot.source.draft_notes_md!;
  const countries = Array.isArray(snapshot.entry?.countries) ? snapshot.entry.countries as string[] : [];
  const key = await openAIKeyHandle(supabase, actor.groupId);
  const embedding = await embed(buildEmbeddingInput(draft, countries), key);
  return {
    content: draft,
    summary: draft,
    embedding,
    metadata: {
      ...snapshot.entry?.metadata,
      meeting_id: snapshot.target?.id ?? snapshot.source.id,
      superseded: {
        at: new Date().toISOString(),
        by_telegram_id: actor.telegramId,
        reason: arbitration.reason,
        prev_meeting_id: snapshot.entry?.metadata?.meeting_id ?? null,
        source_meeting_id: snapshot.source.id,
      },
    },
  };
}

function expectedVersions(token: string): Record<string, unknown> {
  try {
    const value = JSON.parse(atob(token));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ManualMergeError(400, "INVALID_INPUT");
  }
}

const sameVersions = (left: Record<string, unknown>, right: Record<string, unknown>): boolean =>
  Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => left[key] === right[key]);

function decisionResult(stored: StoredDecision, arbitration: ManualMergeArbitration): ManualMergeDecisionResult {
  const reason = stored.arbitration ?? arbitration.reason;
  return {
    id: stored.id,
    decision: stored.decision,
    sourceMeetingId: stored.source_meeting_id,
    canonicalMeetingId: stored.decision === "merge" ? stored.target_meeting_id ?? stored.source_meeting_id : null,
    entryId: stored.decision === "merge" ? stored.target_entry_id : null,
    repeated: stored.repeated === true,
    arbitration: {
      replace: stored.decision === "merge" && (reason === "incoming_richer" || reason === "incoming_has_transcript"),
      reason,
    },
  };
}

export async function decideManualMerge(
  supabase: SupabaseClient,
  sourceId: string,
  input: ManualMergeDecisionInput,
  actor: ManualMergeActor,
  prepare?: PrepareManualEntry,
): Promise<ManualMergeDecisionResult> {
  if (actor.isDemo) throw new ManualMergeError(403, "DEMO_READ_ONLY");
  const snapshot = await getManualPairSnapshot(supabase, sourceId, input.target, input.base, actor);
  const arbitration = arbitrationOf(snapshot);
  if (snapshot.previous && snapshot.previous.decision !== input.decision) {
    throw new ManualMergeError(409, "DECISION_EXISTS");
  }
  if (!snapshot.previous) {
    if (!sameVersions(snapshot.versions, expectedVersions(input.snapshotToken))) {
      throw new ManualMergeError(409, "PAIR_CHANGED");
    }
    if (busy(snapshot)) throw new ManualMergeError(409, "MEETING_BUSY");
    if (!snapshotMatches(snapshot, actor, input.base)) throw new ManualMergeError(409, "PAIR_CHANGED");
  }
  let patch: EntryPatch | null = null;
  if (!snapshot.previous && input.decision === "merge" && arbitration.replace && snapshot.entry) {
    try {
      patch =
        await (prepare ? prepare(snapshot, actor, arbitration) : prepareEntry(snapshot, actor, arbitration, supabase));
    } catch {
      throw new ManualMergeError(503, "PREPARATION_FAILED");
    }
  }
  const { data, error } = await supabase.rpc("decide_manual_meeting_pair", {
    p_actor: actor.telegramId,
    p_group: actor.groupId,
    p_source: sourceId,
    ...targetArgs(input.target),
    p_private: input.base === "personal",
    p_expected: expectedVersions(input.snapshotToken),
    p_decision: input.decision,
    p_replace: arbitration.replace,
    p_arbitration: arbitration.reason,
    p_entry_patch: patch,
  });
  if (error) rpcFailure(error);
  return decisionResult(data as StoredDecision, arbitration);
}

type AuditVersion = StoredDecision & {
  source_snapshot: Record<string, unknown>;
  target_snapshot: Record<string, unknown>;
  entry_snapshot: Record<string, unknown> | null;
  source_notes: unknown[];
  target_notes: unknown[];
};

/** Deliberately returns content/provenance, never an arbitrary raw DB row or credentials. */
function versionView(row: Record<string, unknown>, notes: unknown[]) {
  const metadata = row.metadata as Record<string, unknown> | null;
  return {
    id: row.id,
    title: row.title ?? metadata?.title ?? null,
    startedAt: row.started_at ?? null,
    content: row.content ?? null,
    summary: row.draft_notes_md ?? row.summary ?? null,
    transcript: row.transcript ?? null,
    authorId: row.owner_id ?? row.claim_owner ?? null,
    addedBy: row.added_by ?? null,
    recorders: row.recorders ?? null,
    notes,
  };
}

/** Immutable originals survive merging. Explicitly deleted/archived originals remain unreadable. */
export async function readManualMergeVersions(
  supabase: SupabaseClient,
  sourceId: string,
  decisionId: string,
  actor: ManualMergeActor,
) {
  const { data, error } = await supabase.from("manual_meeting_pair_decisions").select("*").eq("id", decisionId)
    .maybeSingle();
  if (error) throw new ManualMergeError(500, "MANUAL_MERGE_UNAVAILABLE");
  const audit = data as AuditVersion | null;
  if (!audit || audit.decision !== "merge" || audit.source_meeting_id !== sourceId) {
    throw new ManualMergeError(404, "NOT_FOUND");
  }
  const source = await loadManualMeeting(supabase, sourceId, actor);
  await canonicalManualMeeting(supabase, source, actor);
  if (audit.target_meeting_id) {
    const target = await loadManualMeeting(supabase, audit.target_meeting_id, actor);
    await canonicalManualMeeting(supabase, target, actor);
  }
  const target: ManualMergeTarget = audit.target_entry_id
    ? { kind: "entry", id: audit.target_entry_id }
    : { kind: "meeting", id: audit.target_meeting_id! };
  const { data: context, error: contextError } = await supabase.rpc("manual_meeting_pair_snapshot", {
    p_source: sourceId,
    ...targetArgs(target),
    p_private: false,
  });
  if (contextError) rpcFailure(contextError);
  const current = context as ManualPairSnapshot | null;
  if (
    !current ||
    (current.entry &&
      (current.entry.archived_at || current.entry.group_id !== actor.groupId ||
        !canViewEntry(current.entry, actor.telegramId)))
  ) {
    throw new ManualMergeError(404, "NOT_FOUND");
  }
  return {
    id: audit.id,
    source: versionView(audit.source_snapshot, audit.source_notes),
    target: versionView(audit.target_snapshot, audit.target_notes),
    publishedEntry: audit.entry_snapshot ? versionView(audit.entry_snapshot, []) : null,
  };
}
