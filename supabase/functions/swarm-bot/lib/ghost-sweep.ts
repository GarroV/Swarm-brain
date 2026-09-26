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
// Сейчас (D007) heartbeat бота лежит в строке service_agents, одной на агента: встреча жива,
// если удар свежее AGENT_STALE_MIN и его last_meeting_key — ключ этой встречи. Предел: два
// контейнера на двух встречах пишут в строку по очереди, и в момент обхода виден ключ только
// одной — вторая пометится 'failed' посреди записи (как до исправления; запись, дошедшая в
// конце, всё равно обработается). Снимается D018 (T151): heartbeat по встрече в
// meetings.agent_last_seen_at — тогда botKeepsMeetingAlive смотрит на поле кандидата, а не на
// удары агентов.
import { AGENT_STALE_MIN, type AgentBeat } from "./recording-watchdog.ts";

export interface GhostCandidate {
  id: string;
  identity_key: string | null;
}

/** Узкая граница к базе. Реализация на supabase-js — ghost-sweep-store.ts. */
export interface GhostStore {
  /** Пустые встречи (нет summary_status, transcript, process_state, notes, entry), созданные до cutoff. */
  ghostCandidates(cutoffIso: string): Promise<GhostCandidate[]>;
  /** Heartbeat служебных агентов: когда били и по какой встрече. */
  agentBeats(): Promise<AgentBeat[]>;
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
 * Пишет ли бот эту встречу прямо сейчас. Единственное место критерия: T151 (D018) переключит
 * его на meetings.agent_last_seen_at кандидата. Порог — тот же AGENT_STALE_MIN, что у сторожа
 * оборванной записи: «жив» для одного сторожа не должен быть «мёртв» для другого.
 */
export function botKeepsMeetingAlive(
  meeting: GhostCandidate,
  agents: readonly AgentBeat[],
  nowMs: number,
): boolean {
  if (!meeting.identity_key) return false;
  return agents.some((a) => a.last_meeting_key === meeting.identity_key && isFreshBeat(a.last_seen_at, nowMs));
}

export async function sweepGhostMeetings(deps: GhostSweepDeps): Promise<number> {
  const cutoffIso = new Date(deps.nowMs - (deps.staleMinutes ?? GHOST_STALE_MIN) * 60_000).toISOString();
  const candidates = await deps.store.ghostCandidates(cutoffIso);
  if (candidates.length === 0) return 0;
  const agents = await deps.store.agentBeats();
  let swept = 0;
  for (const meeting of candidates) {
    if (botKeepsMeetingAlive(meeting, agents, deps.nowMs)) continue;
    if (await deps.store.markGhostFailed(meeting.id)) swept++;
  }
  return swept;
}
