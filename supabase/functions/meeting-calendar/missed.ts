// Пропуски автозапуска на опросе оркестратора (T102, решения D015/D022): записать, а не только
// сказать в журнал функции.
//
// Что считается пропуском — _shared/calendar-missed.ts; хранилище — _shared/calendar-miss-store.ts.
// Показывает пропуск рекордер человека (meeting-missed); здесь только запись. Два источника:
//   • пропуски прохода по календарю (не Meet, ссылка не разобралась, календарь не подключён / протух);
//   • забранные задания, по которым бот через ARRIVAL_GRACE_MS не подал heartbeat и сам ничего не
//     сказал, — бот не дошёл. Проверка одна на задание: итог — arrival_checked_at.
//
// Сбой записи не роняет опрос: задания боту важнее, а незаписанное повторится на следующем опросе
// (пропуск уникален по человеку, встрече и причине; проверка задания без итога остаётся открытой).
import type { DispatchSkip } from "../_shared/calendar-dispatch.ts";
import { arrivalCheckDue, missFromSkip, type MissRecord, notArrivedMiss } from "../_shared/calendar-missed.ts";
import type { MissStore } from "../_shared/calendar-miss-store.ts";

export interface SweepMissResult {
  recorded: number;
  failed: number;
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Один опрос: записать пропуски и недошедших ботов. Не бросает — сбой пишется в лог. */
export async function recordSweepMisses(
  store: MissStore,
  groupId: string,
  skipped: readonly DispatchSkip[],
  nowMs: number,
  log: (line: string) => void,
): Promise<SweepMissResult> {
  const result: SweepMissResult = { recorded: 0, failed: 0 };
  const fromSkips = skipped.map((s) => missFromSkip(s, nowMs)).filter((m): m is MissRecord => m !== null);
  try {
    await store.recordMisses(groupId, fromSkips);
    result.recorded += fromSkips.length;
  } catch (e) {
    log(`meeting-calendar: пропуски не записаны (${fromSkips.length}): ${reason(e)}`);
    result.failed += fromSkips.length;
  }

  const nowIso = new Date(nowMs).toISOString();
  let candidates;
  try {
    candidates = await store.arrivalCandidates(groupId, nowIso);
  } catch (e) {
    log(`meeting-calendar: задания для проверки «дошёл ли бот» не прочитать: ${reason(e)}`);
    return { ...result, failed: result.failed + 1 };
  }
  for (const job of candidates) {
    if (!arrivalCheckDue(job, nowMs)) continue;
    try {
      const evidence = await store.arrivalEvidence(groupId, job.calendar_key, job.invited_by);
      const miss = notArrivedMiss(job, evidence);
      if (miss !== null) {
        await store.recordMisses(groupId, [miss]);
        result.recorded++;
        log(`meeting-calendar: бот не дошёл до ${job.calendar_key} (календарь ${job.invited_by}) — пропуск записан`);
      }
      // Итог — только после записи: сбой выше оставит проверку открытой для следующего опроса.
      await store.markArrivalChecked(job.id, nowIso);
    } catch (e) {
      log(`meeting-calendar: проверка задания ${job.id} не удалась: ${reason(e)}`);
      result.failed++;
    }
  }
  return result;
}
