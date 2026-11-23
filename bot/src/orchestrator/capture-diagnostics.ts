/**
 * Correlated evidence for capture incidents. No decisions, names, URLs or audio payloads.
 * Adjacent audio-sample/presence-evidence lines remain in the same durable run journal.
 */
export interface CaptureProbeEvidence {
  readonly measuredAtMs: number;
  readonly seconds: number;
  readonly maxDb: number | string | null;
  readonly meanDb: number | string | null;
  readonly samples: number | null;
  readonly thresholdDb: number;
  readonly status: "measured" | "parse_failed" | "failed";
}

interface Observation {
  readonly atMs: number;
  readonly silent: boolean | null;
  readonly alone: boolean | null;
  readonly speakerIndicatorAtMs: number | null;
  readonly probe: CaptureProbeEvidence | null;
}

export class CaptureDiagnostics {
  private episode = 0;
  private incidentAt: number | null = null;
  private gapCount = 0;
  private readonly meetingId: string;
  private readonly thresholdMs: number;
  private readonly log: (line: string) => void;

  constructor(meetingId: string, thresholdMs: number, log: (line: string) => void) {
    this.meetingId = meetingId;
    this.thresholdMs = thresholdMs;
    this.log = log;
  }

  private emit(event: string, sample: Observation, extra: Record<string, number> = {}): void {
    this.log(
      `capture-diagnostic ${JSON.stringify({
        event,
        meetingId: this.meetingId,
        episode: this.episode,
        thresholdMs: this.thresholdMs,
        ...sample,
        ...extra,
      })}`,
    );
  }

  observe(isHealthy: boolean, sample: Observation): void {
    if (sample.silent === null) {
      this.gapCount += 1;
      if (this.gapCount === 1) this.emit("probe_unavailable", sample);
    } else if (this.gapCount > 0) {
      this.emit("probe_resumed", sample, { missedProbes: this.gapCount });
      this.gapCount = 0;
    }
    if (!isHealthy && this.incidentAt === null) {
      this.episode += 1;
      this.incidentAt = sample.atMs;
      this.emit("silence_detected", sample);
    } else if (isHealthy && this.incidentAt !== null) {
      this.emit("sound_returned", sample, {
        sinceDetectionMs: Math.max(0, sample.atMs - this.incidentAt),
      });
      this.incidentAt = null;
    }
  }
}
