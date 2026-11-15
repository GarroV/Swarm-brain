import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { RecordingOrigin, RecordingOriginRow } from "./meeting-transcript-origin.ts";
import { transcriptRecordingOrigin } from "./meeting-transcript-origin.ts";
import { micOwnerId, resolveOwnerName } from "./meeting-speaker-context.ts";

/** A legacy JSON property alone cannot change recording attribution. */
export async function verifiedTranscriptOrigin<T extends RecordingOriginRow>(
  supabase: SupabaseClient,
  row: T,
): Promise<T & { transcript_origin_verified?: boolean }> {
  if (!row.transcript?.manual_merge_origin) return row;
  const { data, error } = await supabase.rpc("manual_meeting_verified_origin", {
    p_meeting: row.id,
    p_transcript: row.transcript,
  });
  if (error) throw new Error("Recording origin verification unavailable");
  return {
    ...row,
    transcript_origin_verified: data != null,
    ...(data == null ? {} : { transcript: { ...row.transcript, manual_merge_origin: data as RecordingOrigin } }),
  };
}

export async function withTranscriptOriginName<T extends RecordingOriginRow>(supabase: SupabaseClient, row: T) {
  const verified = await verifiedTranscriptOrigin(supabase, row);
  if (!verified.transcript_origin_verified) return verified;
  const origin = transcriptRecordingOrigin(verified);
  return {
    ...verified,
    transcript_origin_owner_name: await resolveOwnerName(supabase, micOwnerId(origin.claim_owner, origin.recorders)),
  };
}
