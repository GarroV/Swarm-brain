import { canAccessDraftMeeting, type DraftMeetingRow } from "./meeting-access.ts";
import { canMutateEntry, canViewEntry, type EntryAccessRow } from "./entries/access.ts";
import { matchesPublishVisibility } from "./meeting-publish-visibility.ts";
import { resolvePublishVisibility } from "./meeting-publish-visibility.ts";

export type ManualPairTarget = { meetingId: string | null; entryId: string | null };
export type ManualPairDecision = ManualPairTarget & { sourceId: string; decision: "merge" | "separate" };
export type ManualPairMeeting = DraftMeetingRow & {
  id: string;
  status: string;
  identity_kind?: string | null;
  entry_id?: string | null;
  manual_merge_target_id?: string | null;
  draft_notes_md?: string | null;
  summary_status?: string | null;
};

/** The original meeting identity survives publication; an entry alias is not a new pair. */
export function sameManualPair(
  decision: ManualPairDecision,
  sourceId: string,
  target: ManualPairTarget,
  entryByMeeting: ReadonlyMap<string, string | null>,
): boolean {
  if (decision.sourceId !== sourceId) return false;
  if (decision.meetingId && decision.meetingId === target.meetingId) return true;
  const leftEntry = decision.entryId ?? (decision.meetingId ? entryByMeeting.get(decision.meetingId) : null);
  const rightEntry = target.entryId ?? (target.meetingId ? entryByMeeting.get(target.meetingId) : null);
  return !!leftEntry && leftEntry === rightEntry;
}

export function hasManualRefusal(
  decisions: readonly ManualPairDecision[],
  sourceId: string,
  target: ManualPairTarget,
  entryByMeeting: ReadonlyMap<string, string | null>,
): boolean {
  return decisions.some((decision) =>
    decision.decision === "separate" && sameManualPair(decision, sourceId, target, entryByMeeting)
  );
}

function ownerIds(meeting: DraftMeetingRow): number[] {
  const raw = [
    ...(meeting.recorders ?? []).map((r) => r.telegram_id),
    ...(meeting.co_owners ?? []),
    meeting.claim_owner,
  ];
  return [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id !== 0))];
}

/** Existing guards only. A readable target is not necessarily editable. No owner/ACL union. */
export function manualPairAllowed(
  source: ManualPairMeeting,
  target: ManualPairMeeting | null,
  entry: (EntryAccessRow & { group_id?: string | null; archived_at?: string | null }) | null,
  actorId: number,
  groupId: string,
  isPrivate: boolean,
): boolean {
  if (!entry || (target && target.status !== "in_base")) return false;
  if (source.identity_kind !== "manual" || source.group_id !== groupId) return false;
  if (!canAccessDraftMeeting(source, actorId, false, groupId)) return false;
  if (!resolvePublishVisibility(source, actorId, isPrivate).ok) return false;
  if (target) {
    if (source.id === target.id || target.group_id !== groupId) return false;
    if (!canAccessDraftMeeting(target, actorId, false, groupId)) return false;
    if (!resolvePublishVisibility(target, actorId, isPrivate).ok) return false;
    // The confirmed alias still opens the backing draft, even when its entry is public.
    if (!ownerIds(source).every((id) => canAccessDraftMeeting(target, id, false, groupId))) return false;
  }
  if (entry.group_id !== groupId || entry.archived_at) return false;
  if (!canViewEntry(entry, actorId) || !canMutateEntry(entry, actorId)) return false;
  if (
    !matchesPublishVisibility({ ...entry, shared_with: (entry.shared_with ?? []).map(Number) }, isPrivate, actorId)
  ) return false;
  return ownerIds(source).every((id) => canViewEntry(entry, id));
}

export function manualPairBusy(source: ManualPairMeeting, target: ManualPairMeeting | null): boolean {
  return source.status !== "awaiting_review" || !source.draft_notes_md?.trim() ||
    !!source.manual_merge_target_id || source.summary_status === "processing" ||
    (!!target &&
      (target.summary_status === "processing" || (target.status !== "awaiting_review" && target.status !== "in_base")));
}
