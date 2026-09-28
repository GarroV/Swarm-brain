// Сверка претендента и поправка секунд держателя — запись в базу (T160). Решения — чистые функции
// в challenge.ts; здесь чтение строки, замер частей и условные UPDATE, которыми решение защищено от
// того, что строка изменилась, пока ingest считал.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InMemoryPart } from "../_shared/meeting-processor.ts";
import { claimLeaseUntil } from "../_shared/claim-lease.ts";
import { heldGuards } from "../meeting-claim/arbiter.ts";
import { occupyPatch, takeoverPatch } from "../meeting-claim/claim-patch.ts";
import { withGuards } from "../meeting-claim/guard-query.ts";
import { mp4DurationSec, trackCoverageSec } from "./audio-length.ts";
import { type ChallengeRow, decideChallenge, settleRecorders } from "./challenge.ts";

const CHALLENGE_COLUMNS =
  "claim_owner, recorded_seconds, transcript, notes_edited_at, status, lease_expires_at, agent_last_recording, started_at, created_at, recorders";

/** Сколько секунд записи покрыто звуком, по заголовкам частей (audio-length.ts); не измерено — null. */
export async function measureUpload(parts: readonly InMemoryPart[]): Promise<number | null> {
  const measured = await Promise.all(parts.map(async (p) => ({
    offset: p.offset,
    durationSec: mp4DurationSec(new Uint8Array(await p.blob.arrayBuffer())),
  })));
  return trackCoverageSec(measured);
}

export type ChallengeOutcome =
  /** Право перешло к выгрузившему; `reset` — маркеры обработки сброшены перехватом. */
  | { ok: true; reset: boolean; measuredSec: number | null }
  | { ok: false; status: number; error: string };

/**
 * Выгрузка свежего претендента: измерить, прогнать арбитраж по измеренному и перехватить право той
 * же условной UPDATE, что раньше делал claim. Отказ оставляет строку встречи нетронутой, а
 * претендент в `recorders` становится defer.
 */
export async function settleChallengeUpload(
  supabase: SupabaseClient,
  meetingId: string,
  uploader: number,
  micStartOffset: number | null,
  parts: readonly InMemoryPart[],
  nowIso: string,
): Promise<ChallengeOutcome> {
  const { data } = await supabase.from("meetings").select(CHALLENGE_COLUMNS).eq("id", meetingId).maybeSingle();
  if (!data) return { ok: false, status: 404, error: "meeting not found" };
  const row = data as ChallengeRow & { recorders: unknown };
  const measuredSec = await measureUpload(parts);
  const verdict = decideChallenge(row, measuredSec, uploader, nowIso);
  console.log(
    `meeting-ingest: претендент ${meetingId} — измерено ${
      measuredSec === null ? "—" : Math.round(measuredSec)
    }с у ${uploader} против ${row.recorded_seconds ?? "—"}с у ${row.claim_owner} → ${verdict.kind}`,
  );
  if (verdict.kind === "refuse") {
    await writeRecorders(supabase, meetingId, settleRecorders(row.recorders, uploader, "defer", null, null));
    return { ok: false, status: 409, error: verdict.reason };
  }

  const patchInput = {
    ownerId: uploader,
    leaseIso: claimLeaseUntil(nowIso),
    nowIso,
    micStartOffset,
    recordedSeconds: verdict.seconds,
  };
  const update = verdict.kind === "takeover"
    ? withGuards(
      supabase.from("meetings").update(takeoverPatch(patchInput)).eq("id", meetingId),
      heldGuards(row, nowIso),
    )
    : supabase.from("meetings").update(occupyPatch(patchInput)).eq("id", meetingId).is("transcript", null)
      .or(`claim_owner.is.null,lease_expires_at.lt.${nowIso}`);
  const { data: took } = await update.select("id").maybeSingle();
  if (!took) {
    // Строка изменилась, пока считали (удар бота, другой перехват): решение по устаревшему чтению.
    await writeRecorders(supabase, meetingId, settleRecorders(row.recorders, uploader, "defer", null, null));
    return { ok: false, status: 409, error: "meeting changed while the upload was checked, claim again" };
  }
  const supersede = verdict.kind === "takeover" ? row.claim_owner : null;
  await writeRecorders(
    supabase,
    meetingId,
    settleRecorders(row.recorders, uploader, "transcribe", verdict.seconds, supersede),
  );
  return { ok: true, reset: verdict.kind === "takeover", measuredSec };
}

async function writeRecorders(supabase: SupabaseClient, meetingId: string, recorders: unknown[]): Promise<void> {
  const { error } = await supabase.from("meetings").update({ recorders }).eq("id", meetingId);
  if (error) console.error(`meeting-ingest: recorders ${meetingId} после сверки претендента: ${error.message}`);
}

/**
 * Опустить секунды встречи до измеренного — той же строкой, что прочитана: держатель прежний,
 * секунды не менялись, бот на встрече так и не появился.
 */
export async function lowerHolderSeconds(
  supabase: SupabaseClient,
  meetingId: string,
  uploader: number,
  readSeconds: number,
  measuredSec: number,
): Promise<void> {
  const { data, error } = await supabase.from("meetings").update({ recorded_seconds: measuredSec })
    .eq("id", meetingId).eq("claim_owner", uploader).eq("recorded_seconds", readSeconds)
    .is("agent_last_seen_at", null).select("id");
  if (error) console.error(`meeting-ingest: секунды держателя ${meetingId}: ${error.message}`);
  else if ((data ?? []).length > 0) {
    console.log(
      `meeting-ingest: ${meetingId} — секунды держателя ${Math.round(readSeconds)}→${
        Math.round(measuredSec)
      } по измеренной выгрузке`,
    );
  }
}
