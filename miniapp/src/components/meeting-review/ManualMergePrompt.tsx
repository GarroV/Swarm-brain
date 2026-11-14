"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDt } from "@/components/roy/nav";
import { manualMeetingMergeApi as api } from "@/lib/manualMeetingMergeApi";
import {
  type ManualMergeBase,
  type ManualMergeCandidate,
  type ManualMergeDecisionResult,
  manualMergeErrorKind,
} from "@/lib/manualMeetingMergeRequest";
import {
  MANUAL_MERGE_COPY as COPY,
  ManualMergeQuestion,
} from "./ManualMergeQuestion";

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "candidate"; candidate: ManualMergeCandidate }
  | { kind: "saving"; candidate: ManualMergeCandidate }
  | { kind: "error"; error: "changed" | "busy" | "missing" | "failed" };

/** Read on mount; changing a suggestion never retries a write without a new Yes/No. */
export function ManualMergePrompt(
  { meetingId, base, disabled = false, onBusyChange, onDecided }: {
    meetingId: string;
    base: ManualMergeBase;
    disabled?: boolean;
    onBusyChange: (busy: boolean) => void;
    onDecided: (result: ManualMergeDecisionResult) => void;
  },
) {
  const dt = useDt();
  const [state, setState] = useState<State>({ kind: "loading" });
  const generation = useRef(0), writing = useRef(false);
  const reload = useCallback(() => {
    const revision = ++generation.current;
    setState({ kind: "loading" });
    void api.candidate(meetingId, base).then((candidate) => {
      if (revision !== generation.current) return;
      if (
        candidate &&
        (candidate.sourceMeetingId !== meetingId || candidate.base !== base)
      ) {
        setState({ kind: "error", error: "changed" });
        return;
      }
      setState(
        candidate ? { kind: "candidate", candidate } : { kind: "empty" },
      );
    }).catch((error: unknown) => {
      if (revision === generation.current) {
        setState({ kind: "error", error: manualMergeErrorKind(error) });
      }
    });
  }, [meetingId, base]);

  useEffect(() => {
    reload();
    return () => {
      ++generation.current;
    };
  }, [reload]);
  useEffect(() => {
    onBusyChange(state.kind === "saving");
    return () => onBusyChange(false);
  }, [state.kind, onBusyChange]);

  const decide = async (decision: "merge" | "separate") => {
    if (state.kind !== "candidate" || writing.current || disabled) return;
    writing.current = true;
    const { candidate } = state, revision = ++generation.current;
    setState({ kind: "saving", candidate });
    try {
      const result = await api.decide(meetingId, {
        target: { kind: candidate.target.kind, id: candidate.target.id },
        base,
        snapshotToken: candidate.snapshotToken,
        decision,
      });
      if (revision !== generation.current) return;
      if (
        result.sourceMeetingId !== meetingId || result.decision !== decision
      ) {
        setState({ kind: "error", error: "changed" });
        return;
      }
      setState({ kind: "empty" });
      onDecided(result);
    } catch (error) {
      if (revision === generation.current) {
        setState({ kind: "error", error: manualMergeErrorKind(error) });
      }
    } finally {
      writing.current = false;
    }
  };

  if (state.kind === "empty") return null;
  if (state.kind === "candidate" || state.kind === "saving") {
    return (
      <ManualMergeQuestion
        candidate={state.candidate}
        busy={state.kind === "saving" || disabled}
        onDecision={(decision) => {
          void decide(decision);
        }}
      />
    );
  }
  if (state.kind === "loading") {
    return (
      <p role="status" className="mb-4 text-xs text-ink-soft">
        {dt(COPY.loading.ru, COPY.loading.en)}
      </p>
    );
  }
  const error = COPY[state.error];
  return (
    <section className="mb-4 rounded-[10px] border border-line bg-surface px-4 py-3">
      <p role="alert" className="text-sm text-ink-soft">
        {dt(error.ru, error.en)}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={reload}
        className="mt-2 min-h-10 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
      >
        {dt(COPY.retry.ru, COPY.retry.en)}
      </button>
    </section>
  );
}
