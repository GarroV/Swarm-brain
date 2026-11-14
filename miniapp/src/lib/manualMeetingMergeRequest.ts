import type {
  ManualMergeBase,
  ManualMergeCandidate,
  ManualMergeDecisionInput,
  ManualMergeDecisionResult,
} from "../../../supabase/functions/_shared/manual-meeting-merge-types.ts";
export type {
  ManualMergeBase,
  ManualMergeCandidate,
  ManualMergeDecisionInput,
  ManualMergeDecisionResult,
};

type Requester = <T>(path: string, options?: RequestInit) => Promise<T>;

/** The transport supplies the existing authenticated session; the client never supplies an actor. */
export function createManualMeetingMergeApi(request: Requester) {
  return {
    candidate(sourceId: string, base: ManualMergeBase) {
      return request<ManualMergeCandidate | null>(
        `/agent-meetings/${
          encodeURIComponent(sourceId)
        }/manual-merge-candidate?base=${encodeURIComponent(base)}`,
        { cache: "no-store" },
      );
    },
    decide(sourceId: string, input: ManualMergeDecisionInput) {
      // Project the allowed fields even when a caller is untyped; never spread content or rights.
      const { decision, base, snapshotToken } = input;
      const target = { kind: input.target.kind, id: input.target.id };
      return request<ManualMergeDecisionResult>(
        `/agent-meetings/${encodeURIComponent(sourceId)}/manual-merge-decision`,
        {
          method: "POST",
          body: JSON.stringify({ target, decision, base, snapshotToken }),
        },
      );
    },
  };
}

/** Raw provider/server messages are not UI copy. A conflict always needs a fresh human decision. */
export function manualMergeErrorKind(
  error: unknown,
): "changed" | "busy" | "missing" | "failed" {
  if (!error || typeof error !== "object") return "failed";
  const value = error as { status?: unknown; body?: { code?: unknown } };
  if (value.status === 404) return "missing";
  if (value.status === 409) {
    return value.body?.code === "MEETING_BUSY" ? "busy" : "changed";
  }
  return "failed";
}
