// Что пишет meeting-claim в строку встречи, когда право транскрибации переходит к новому
// claim_owner: свободная встреча занята (лиз истёк, транскрипта нет) или перехвачена заметно более
// полной записью. Вынесено чистыми функциями, чтобы поля перехода держали тесты, а не глаз.
//
// Сброс meetings.agent_last_recording (D019). Флаг взводит heartbeat бота встреч, пока тот пишет
// встречу от имени прежнего claim_owner. После перехода удары бота получают 403 (meeting-heartbeat
// сверяет claim_owner), флаг без сброса остался бы true — и сторож оборванной записи прислал бы
// НОВОМУ claim_owner ложный алерт «бот перестал отвечать». Сброс едет тем же UPDATE, что и смена
// claim_owner: удар бота, пришедший между ними, либо успевает до перехвата (и перехват его
// перетирает), либо после — и уже не совпадает по claim_owner. Отдельный второй UPDATE оставил бы
// щель, в которую удар вернул бы флаг.

export interface ClaimPatchInput {
  ownerId: number;
  leaseIso: string;
  nowIso: string;
  micStartOffset: number | null;
  recordedSeconds: number | null;
}

/** Занять свободную встречу. */
export function occupyPatch(input: ClaimPatchInput): Record<string, unknown> {
  return {
    claim_owner: input.ownerId,
    lease_expires_at: input.leaseIso,
    updated_at: input.nowIso,
    mic_start_offset: input.micStartOffset,
    recorded_seconds: input.recordedSeconds,
    agent_last_recording: false,
  };
}

/**
 * Перехватить право более полной записью. Сбрасываются ТОЛЬКО маркеры обработки:
 * transcript/draft_notes_md остаются до прихода нового аудио.
 */
export function takeoverPatch(input: ClaimPatchInput): Record<string, unknown> {
  return {
    ...occupyPatch(input),
    summary_status: null,
    process_state: null,
    processing_lease: null,
    last_progress_at: null,
  };
}

/**
 * Тот же человек с заметно более полной записью, бот при этом не пишет (arbiter.ts, `refresh`).
 * claim_owner не меняется, поэтому маркеры обработки НЕ сбрасываются: сброс посреди работы воркера
 * стоил повторной транскрибации (сдача T156), а вторую запись того же владельца meeting-ingest
 * сравнивает сам (очередь / претендент). Пульс бота тоже не трогается: алерт о замолчавшем боте
 * уходит тому же человеку и правдив.
 */
export function refreshPatch(input: ClaimPatchInput): Record<string, unknown> {
  return {
    lease_expires_at: input.leaseIso,
    updated_at: input.nowIso,
    mic_start_offset: input.micStartOffset,
    recorded_seconds: input.recordedSeconds,
  };
}
