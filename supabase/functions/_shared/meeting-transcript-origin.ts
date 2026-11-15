/** Recording provenance is independent from the canonical meeting's ownership/identity. */
export type RecordingOrigin = {
  meeting_id?: string | null;
  started_at?: string | null;
  claim_owner?: number | null;
  recorders?: Array<{ telegram_id: number }> | null;
};

export type RecordingOriginRow = {
  id?: string;
  started_at?: string | null;
  claim_owner?: number | null;
  recorders?: Array<{ telegram_id: number }> | null;
  transcript?: { manual_merge_origin?: RecordingOrigin | null } | null;
  /** Server-derived proof of an exact immutable applied version, never ingest JSON. */
  transcript_origin_verified?: boolean;
};

/** No origin preserves legacy context. A known origin never falls back to an unrelated owner. */
export function transcriptRecordingOrigin(row: RecordingOriginRow): Required<RecordingOrigin> & { merged: boolean } {
  const origin = row.transcript_origin_verified === true ? row.transcript?.manual_merge_origin : null;
  const source = origin ?? row;
  return {
    meeting_id: origin?.meeting_id ?? row.id ?? null,
    started_at: source.started_at ?? null,
    claim_owner: source.claim_owner ?? null,
    recorders: source.recorders ?? null,
    merged: origin != null,
  };
}
