// Сторож встреч-призраков: claim был, а ingest так и не отработал (например, совсем пустая
// запись — ни mic, ни system). Интерфейс поллит такую встречу «готовится» вечно, поэтому
// старые пустые строки метятся summary_status='failed' — без Telegram, обработка даже не
// начиналась. Пометка — не удаление: строка остаётся, meeting-ingest пускает 'failed' на
// повторную обработку.
//
// Исключение — встреча, которую прямо сейчас пишет бот scriba (#549). Рекордер человека
// (bumblebee) делает claim и ingest рядом, а бот заявляет встречу ДО захода и отдаёт запись
// только в конце: между ними вся встреча, и пустая строка старше 15 минут для него норма.
// Живость бота на встрече решает ОДНА функция — botKeepsMeetingAlive.
//
// Heartbeat бота лежит в строке самой встречи (D018, meetings.agent_last_seen_at): встреча
// жива, если её удар свежее AGENT_STALE_MIN. Две встречи бота одновременно не мешают друг
// другу — у каждой своя отметка (до D018 строка была одна на агента, и вторая встреча метилась
// 'failed' посреди записи).
import { AGENT_STALE_MIN } from "./recording-watchdog.ts";

export interface GhostCandidate {
  id: string;
  /** Последний удар бота по этой встрече; null — бот её не писал (встреча рекордера человека). */
  agent_last_seen_at: string | null;
}

/** Узкая граница к базе. Реализация на supabase-js — ghost-sweep-store.ts. */
export interface GhostStore {
  /** Пустые встречи (нет summary_status, transcript, process_state, notes, entry), созданные до cutoff. */
  ghostCandidates(cutoffIso: string): Promise<GhostCandidate[]>;
  /** Пометить 'failed', только если встреча всё ещё пустая. false — пока шёл обход, пришёл ingest. */
  markGhostFailed(meetingId: string): Promise<boolean>;
}

export interface GhostSweepDeps {
  store: GhostStore;
  nowMs: number;
  staleMinutes?: number;
}

/** Порог «встреча брошена», как был у сторожа до #549. */
export const GHOST_STALE_MIN = 15;

/** Удар свежий: был, читается и не старше порога сторожа оборванной записи (граница включительно). */
function isFreshBeat(lastSeen: string | null, nowMs: number): boolean {
  if (!lastSeen) return false;
  const seenMs = Date.parse(lastSeen);
  if (Number.isNaN(seenMs)) return false;
  return seenMs >= nowMs - AGENT_STALE_MIN * 60_000;
}

/**
 * Пишет ли бот эту встречу прямо сейчас. Единственное место критерия. Порог — тот же
 * AGENT_STALE_MIN, что у сторожа оборванной записи: «жив» для одного сторожа не должен быть
 * «мёртв» для другого.
 */
export function botKeepsMeetingAlive(meeting: GhostCandidate, nowMs: number): boolean {
  return isFreshBeat(meeting.agent_last_seen_at, nowMs);
}

export async function sweepGhostMeetings(deps: GhostSweepDeps): Promise<number> {
  const cutoffIso = new Date(deps.nowMs - (deps.staleMinutes ?? GHOST_STALE_MIN) * 60_000).toISOString();
  const candidates = await deps.store.ghostCandidates(cutoffIso);
  let swept = 0;
  for (const meeting of candidates) {
    if (botKeepsMeetingAlive(meeting, deps.nowMs)) continue;
    if (await deps.store.markGhostFailed(meeting.id)) swept++;
  }
  return swept;
}
