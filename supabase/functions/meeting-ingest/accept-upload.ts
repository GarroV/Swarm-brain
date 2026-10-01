// Приём выгрузки в строку встречи — условной UPDATE по тому, что видели при проверках (issue #578).
//
// meeting-ingest проверяет владельца, статус и поколение состояния ДО долгой части (разбор и заливка
// аудио в Storage), а писал потом безусловно. За это время строка могла смениться:
// - ретрай клиента (потерянный 202) шёл параллельно первой выгрузке: обе видели «не в обработке»,
//   обе писали свой process_state — вторая затирала поколение первой, и аудио уходило в Whisper дважды;
// - встречу перехватил другой рекордер (claim_owner сменился) — выгрузка затирала его обработку;
// - встречу опубликовали или начали править.
// Теперь запись проходит, только если строка такая же, какой её проверили; иначе — конфликт.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unfrozen } from "../_shared/meeting-frozen.ts";

/** Что видели при проверках: строка обязана остаться такой же к моменту записи. */
export interface UploadExpectation {
  claimOwner: number | null;
  summaryStatus: string | null;
  /** Поколение текущего process_state; null — состояния нет или оно старой формы (без gen). */
  gen: string | null;
}

/** true — выгрузка принята; false — строка изменилась с момента проверок, ничего не записано. */
export async function acceptUpload(
  supabase: SupabaseClient,
  meetingId: string,
  expect: UploadExpectation,
  patch: Record<string, unknown>,
): Promise<boolean> {
  let q = supabase.from("meetings").update(patch).eq("id", meetingId);
  q = expect.claimOwner === null ? q.is("claim_owner", null) : q.eq("claim_owner", expect.claimOwner);
  q = expect.summaryStatus === null ? q.is("summary_status", null) : q.eq("summary_status", expect.summaryStatus);
  q = expect.gen === null ? q.is("process_state->>gen", null) : q.eq("process_state->>gen", expect.gen);
  const { data, error } = await unfrozen(q).select("id");
  if (error) throw new Error(`meetings ${meetingId}: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
