import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isActive, readMaintenance } from "./maintenance.ts";

// Заморозка откладывает обработку встреч (решение владельца 01.10.2026,
// docs/decisions/2026-10-01-freeze-pauses-processing.md): «мы точно сохраняем сами данные, саму
// запись, но дальнейшее уже позже после разморозки».
//
// Приём записи (meeting-claim, meeting-ingest) заморозку не смотрит: аудио ложится в хранилище,
// встреча встаёт в 'processing', рекордер получает свой 202. А шаг обработки (runMeetingStep — его
// зовут и inline-проход приёма, и cron meeting-process) при действующей заморозке новых встреч не
// берёт: ни лиза, ни записи в строку. После `until` или `make unfreeze` следующий тик cron
// подхватывает всё сам. Уже идущий шаг не прерывается — он доработает свой бюджет.
//
// Срок — тот же, что у заморозки веба (`isActive`: между starts_at и until), одно правило на всех.

/** Действует ли сейчас заморозка обработки. Сбой чтения = «нет» (как у веба: не запирать продукт). */
export async function processingFrozen(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<boolean> {
  return isActive(await readMaintenance(supabase, now), now) === true;
}

/**
 * Отметка «жива, ждёт» для встреч, отложенных заморозкой. Сторож застоя (swarm-bot
 * sweepStuckMeetings) валит в 'failed' встречу без прогресса дольше 15 минут, а заморозка длится
 * дольше. Пишем ТОЛЬКО last_progress_at и только тем, кого сейчас не двигает живой шаг (свежий
 * лиз): статусы, попытки и манифест не трогаем. Возвращает число отмеченных.
 * `leaseStaleMs` — тот же порог протухания лиза, что у шага (LEASE_STALE_MS в meeting-processor;
 * передаётся, а не импортируется, потому что meeting-processor сам импортирует этот модуль).
 */
export async function holdWaitingMeetings(
  supabase: SupabaseClient,
  leaseStaleMs: number,
  now: Date = new Date(),
): Promise<number> {
  const staleIso = new Date(now.getTime() - leaseStaleMs).toISOString();
  const { data, error } = await supabase
    .from("meetings")
    .update({ last_progress_at: now.toISOString() })
    .eq("summary_status", "processing")
    .or(`processing_lease.is.null,processing_lease.lt.${staleIso}`)
    .select("id");
  if (error) {
    console.error("processing-freeze: hold waiting meetings failed:", error);
    return 0;
  }
  return (data ?? []).length;
}
