// Пустой слот бота встреч: единое правило «показывать ли черновик в очереди вычитки».
// Читают GET /agent-meetings, счётчики вычитки (swarm-api/admin.ts) и MCP get_review_queue —
// чтобы числа и списки не расходились. Живость бота решает та же граница, что у сторожей
// (BOT_PROFILE.silentMinutes = AGENT_STALE_MIN в swarm-bot/lib/recording-watchdog.ts).
import { BOT_PROFILE } from "./bot-profile.ts";

/** Колонки, без которых isMissedBotSlot не решает: добавлять в select каждого читателя очереди. */
export const BOT_SLOT_COLUMNS =
  "agent_version, recorded_by, recorded_seconds, summary_status, agent_last_seen_at, agent_last_recording, entry_id, has_draft_notes";

/** Удар бота свежий: был, читается и не старше порога тишины (граница включительно). */
export function isFreshBotBeat(lastSeen: unknown, nowMs: number): boolean {
  if (typeof lastSeen !== "string" || !lastSeen) return false;
  const seenMs = Date.parse(lastSeen);
  if (Number.isNaN(seenMs)) return false;
  return seenMs >= nowMs - BOT_PROFILE.silentMinutes * 60_000;
}

export type SlotRow = {
  agent_version?: unknown;
  recorded_by?: unknown;
  recorded_seconds?: unknown;
  summary_status?: unknown;
  agent_last_seen_at?: unknown;
  agent_last_recording?: unknown;
  entry_id?: unknown;
  has_draft_notes?: boolean | null;
};

/**
 * Бот встреч заявил встречу ДО захода (meeting-claim), а записи нет: строка пустая — без секунд,
 * записавшего, тезисов и записи в базе. Такая строка показывается ТОЛЬКО пока бот реально пишет
 * её: флаг agent_last_recording взведён И удар agent_last_seen_at свежий. Ждёт у двери, не впустили,
 * сбой захода, тишина дольше порога, пометка failed — слот прячется сразу, а не через час, когда
 * его добьёт сторож призраков. Решение владельца 03.10.2026 («не надо пустые встречи в базу
 * вкидывать», #788), уточнено 13.10.2026. Запись рекордера в ту же строку (секунды, recorded_by)
 * снимает признак: настоящую запись не прячем никогда.
 */
export function isMissedBotSlot(row: SlotRow, nowMs: number = Date.now()): boolean {
  const byBot = typeof row.agent_version === "string" && row.agent_version.startsWith(`${BOT_PROFILE.name}-`);
  if (!byBot) return false;
  const recorded = typeof row.recorded_seconds === "number" && row.recorded_seconds > 0;
  const hasContent = row.recorded_by != null || row.entry_id != null || row.has_draft_notes === true;
  if (recorded || hasContent) return false;
  if (row.summary_status === "failed") return true;
  const liveNow = row.agent_last_recording === true && isFreshBotBeat(row.agent_last_seen_at, nowMs);
  return !liveNow;
}
