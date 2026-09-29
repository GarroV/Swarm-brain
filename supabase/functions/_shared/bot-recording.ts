// Пишет ли бот встречу прямо сейчас — одно правило для арбитра записей (meeting-claim/arbiter.ts)
// и для «комната уже занята ботом» (_shared/manual-rooms.ts).

export interface BotRecordingRow {
  lease_expires_at: string | null;
  agent_last_recording: boolean | null;
}

/**
 * Бот ещё пишет встречу: флаг записи взведён ударом recording:true И лиз действует. Лиз продлевают
 * только удары recording:true (meeting-heartbeat), так что умерший бот с оставшимся флагом
 * перестаёт считаться пишущим не позже, чем через срок лиза.
 */
export function botStillRecording(row: BotRecordingRow, nowIso: string): boolean {
  return row.agent_last_recording === true && row.lease_expires_at !== null &&
    Date.parse(row.lease_expires_at) > Date.parse(nowIso);
}
