// Сторож встреч-призраков: claim был, а ingest так и не отработал (например, совсем пустая
// запись — ни mic, ни system). Интерфейс поллит такую встречу «готовится» вечно, поэтому
// старые пустые строки метятся summary_status='failed' — без Telegram, обработка даже не
// начиналась. Пометка — не удаление: строка остаётся, meeting-ingest пускает 'failed' на
// повторную обработку.
//
// Исключение — встреча, которую прямо сейчас пишет бот встреч (#549). Рекордер человека
// (bumblebee) делает claim и ingest рядом, а бот заявляет встречу ДО захода и отдаёт запись
// только в конце: между ними вся встреча, и пустая строка старше 15 минут для него норма.
// Живость бота на встрече решает ОДНА функция — botKeepsMeetingAlive.
//
// Heartbeat бота лежит в строке самой встречи (D018, meetings.agent_last_seen_at): встреча
// жива, если её удар свежее AGENT_STALE_MIN. Две встречи бота одновременно не мешают друг
// другу — у каждой своя отметка (до D018 строка была одна на агента, и вторая встреча метилась
// 'failed' посреди записи).
import { isFreshBotBeat } from "../../_shared/bot-slot.ts";
import { WEB_RECORDER_SOURCE, WEB_STALE_MIN } from "../../_shared/web-recording.ts";

export interface GhostCandidate {
  id: string;
  /** Последний удар бота по этой встрече; null — бот её не писал (встреча рекордера человека). */
  agent_last_seen_at: string | null;
  /** meetings.source: у записи из браузера (web-recorder) пустая строка — норма, пока в неё льются куски. */
  source: string | null;
  /** Последняя активность по строке: запись из браузера бьёт её на каждый принятый кусок. */
  updated_at: string | null;
}

/** Узкая граница к базе. Реализация на supabase-js — ghost-sweep-store.ts. */
export interface GhostStore {
  /** Пустые встречи (нет summary_status, transcript, process_state, notes, entry), созданные до cutoff. */
  ghostCandidates(cutoffIso: string): Promise<GhostCandidate[]>;
  /** Пометить 'failed', только если встреча всё ещё пустая. false — пока шёл обход, пришёл ingest. */
  markGhostFailed(meetingId: string): Promise<boolean>;
  /**
   * Завершить брошенную запись из браузера тем же кодом, что кнопка «завершить»: куски есть —
   * уходит в обработку, нет — 'failed'. false — пока шёл обход, её завершили рядом.
   */
  finalizeWebRecording(meetingId: string): Promise<boolean>;
}

export interface GhostSweepDeps {
  store: GhostStore;
  nowMs: number;
  staleMinutes?: number;
}

/** Порог «встреча брошена», как был у сторожа до #549. */
export const GHOST_STALE_MIN = 15;

/**
 * Пишет ли бот эту встречу прямо сейчас. Единственное место критерия. Порог — тот же
 * AGENT_STALE_MIN, что у сторожа оборванной записи: «жив» для одного сторожа не должен быть
 * «мёртв» для другого.
 */
export function botKeepsMeetingAlive(meeting: GhostCandidate, nowMs: number): boolean {
  return isFreshBotBeat(meeting.agent_last_seen_at, nowMs);
}

/**
 * Пишет ли человек эту встречу из браузера прямо сейчас: куски приходят, строка бьёт updated_at.
 * Единственное место критерия; порог WEB_STALE_MIN длиннее призрачных 15 минут — вкладка под
 * блокировкой экрана может молчать дольше, не будучи брошенной.
 */
export function webRecordingStillLive(meeting: GhostCandidate, nowMs: number): boolean {
  if (meeting.source !== WEB_RECORDER_SOURCE) return false;
  const beat = meeting.updated_at ? Date.parse(meeting.updated_at) : NaN;
  return Number.isFinite(beat) && nowMs - beat <= WEB_STALE_MIN * 60_000;
}

export async function sweepGhostMeetings(deps: GhostSweepDeps): Promise<number> {
  const cutoffIso = new Date(deps.nowMs - (deps.staleMinutes ?? GHOST_STALE_MIN) * 60_000).toISOString();
  const candidates = await deps.store.ghostCandidates(cutoffIso);
  let swept = 0;
  for (const meeting of candidates) {
    if (meeting.source === WEB_RECORDER_SOURCE) {
      // Не призрак, а запись из браузера: пока куски идут — не трогаем, брошенную — завершаем
      // (куски дошли → обработка; нет — 'failed' внутри finalize).
      if (webRecordingStillLive(meeting, deps.nowMs)) continue;
      if (await deps.store.finalizeWebRecording(meeting.id)) swept++;
      continue;
    }
    if (botKeepsMeetingAlive(meeting, deps.nowMs)) continue;
    if (await deps.store.markGhostFailed(meeting.id)) swept++;
  }
  return swept;
}
