// Log capture-state/write transitions without another database read or raw request payload.
export class CaptureHeartbeatJournal {
  private readonly seen = new Map<string, string>();
  constructor(private readonly log: (line: string) => void, private readonly limit = 200) {}

  record(
    identity: { kind: string; agentId?: string },
    body: { audio_healthy?: unknown; meeting_id?: unknown },
    writeOutcome: "ok" | "stale" | "missed" | "failed",
    at: string,
  ): void {
    if (identity.kind !== "bot" || typeof body.audio_healthy !== "boolean" || typeof body.meeting_id !== "string") {
      return;
    }
    const key = `${identity.agentId ?? "unknown"}:${body.meeting_id}`;
    const state = `${body.audio_healthy}:${writeOutcome}`;
    if (this.seen.get(key) === state) return;
    this.seen.delete(key);
    this.seen.set(key, state);
    if (this.seen.size > this.limit) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.log(
      `capture-heartbeat ${
        JSON.stringify({
          event: "capture_health_write",
          at,
          meetingId: body.meeting_id,
          agentId: identity.agentId ?? null,
          audioHealthy: body.audio_healthy,
          writeOutcome,
        })
      }`,
    );
  }
}
