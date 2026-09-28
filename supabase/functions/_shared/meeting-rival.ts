// Запись претендента, сравниваемая с версией держателя (T168). Претендент — другой человек,
// выгрузивший заметно более длинную запись, когда у держателя уже есть своя версия встречи
// (готовая стенограмма или идущая обработка). Длина слепа к потерянному звуку (#10), поэтому
// право по ней не переходит: meeting-ingest ставит запись на сравнение (очередь или `challenge`),
// а владелец встречи меняется той же UPDATE, что пишет стенограмму претендента, — и только если
// по объёму распознанного осталась она. Иначе встреча говорила бы от имени одного человека, а
// стенограмма была бы другого («я» в тезисах, уведомления, право правки).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimLeaseUntil } from "./meeting-lease.ts";
import { updateRecorders } from "./recorders-write.ts";
import { occupyPatch } from "../meeting-claim/claim-patch.ts";
import { type RecorderEntry, settleRecorders } from "../meeting-ingest/challenge.ts";

/** Что претендент заявил и что сервер измерил — переходит к встрече вместе с его стенограммой. */
export interface RivalClaim {
  recordedSeconds: number;
  micStartOffset: number | null;
}

/** Поля владельца встречи для UPDATE, пишущей стенограмму претендента. */
export function rivalOwnershipPatch(owner: number, rival: RivalClaim, nowIso: string): Record<string, unknown> {
  return occupyPatch({
    ownerId: owner,
    leaseIso: claimLeaseUntil(nowIso),
    nowIso,
    micStartOffset: rival.micStartOffset,
    recordedSeconds: rival.recordedSeconds,
  });
}

/** `recorders` после сравнения: победил — transcribe, держатель superseded; нет — defer. */
export function rivalRecorders(
  recorders: unknown,
  owner: number,
  seconds: number,
  won: boolean,
  priorOwner: number | null,
): RecorderEntry[] {
  return won
    ? settleRecorders(recorders, owner, "transcribe", seconds, priorOwner)
    : settleRecorders(recorders, owner, "defer", null, null);
}

export async function settleRival(
  supabase: SupabaseClient,
  meetingId: string,
  owner: number,
  rival: RivalClaim,
  won: boolean,
  priorOwner: number | null,
): Promise<void> {
  try {
    const ok = await updateRecorders(
      supabase,
      meetingId,
      (current) => rivalRecorders(current, owner, rival.recordedSeconds, won, priorOwner),
    );
    if (!ok) console.error(`meeting-rival: recorders ${meetingId} после сравнения не записаны`);
  } catch (e) {
    console.error(`meeting-rival: recorders ${meetingId} после сравнения:`, e);
  }
}
