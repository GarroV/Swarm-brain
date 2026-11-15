// Feature DTOs only: shared by the edge routes and review UI, no runtime/SDK dependencies.
export type ManualMergeTarget = { kind: "meeting" | "entry"; id: string };
export type ManualMergeBase = "workspace" | "personal";
export type ManualMergeArbitration = {
  replace: boolean;
  reason: "incoming_richer" | "incoming_has_transcript" | "published_edited" | "incoming_edited" | "not_richer";
};

export type ManualMergeCandidate = {
  sourceMeetingId: string;
  base: ManualMergeBase;
  target: ManualMergeTarget & {
    title: string;
    startedAt: string | null;
    recorderNames: string[];
    inBase: boolean;
    meetingId: string | null;
    entryId: string | null;
  };
  snapshotToken: string;
  arbitration: ManualMergeArbitration;
};

export type ManualMergeDecisionInput = {
  target: ManualMergeTarget;
  decision: "merge" | "separate";
  base: ManualMergeBase;
  snapshotToken: string;
};

export type ManualMergeDecisionResult = {
  id: string;
  decision: "merge" | "separate";
  sourceMeetingId: string;
  canonicalMeetingId: string | null;
  entryId: string | null;
  repeated: boolean;
  arbitration: ManualMergeArbitration;
};
