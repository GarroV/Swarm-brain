// Пишет ли бот встречу прямо сейчас — одно правило для арбитра записей (meeting-claim/arbiter.ts)
// и для «комната уже занята ботом» (_shared/manual-rooms.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

/** Строка встречи для «её уже пишут»: ключ календаря и признаки живой записи. */
export interface RecordedNowRow extends BotRecordingRow {
  identity_key: string | null;
}

/**
 * Ключи встреч, которые прямо сейчас пишет бот (или чужой рекордер) — для рекордера человека,
 * чтобы он не предлагал «Записать» звонок, который уже пишется (issue #821). Отбор по человеку
 * делает запрос (`loadRecordedNow`), здесь — только «пишет ли сейчас».
 */
export function recordedNowKeys(rows: readonly RecordedNowRow[], nowIso: string): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.identity_key && botStillRecording(r, nowIso)) keys.add(r.identity_key);
  }
  return [...keys];
}

/**
 * Встречи с участием человека (записывал, совладелец или участник по e-mail приглашения), которые
 * сейчас пишутся. Ошибка базы — пустой список: лишняя плашка «Записать» безопаснее, чем пропавшая.
 */
export async function loadRecordedNow(
  client: SupabaseClient,
  telegramId: number,
  email: string | null,
  nowIso: string,
): Promise<string[]> {
  const id = Math.trunc(telegramId);
  const who = [`recorders.cs.[{"telegram_id":${id}}]`, `co_owners.cs.{${id}}`];
  const mail = (email ?? "").trim().toLowerCase();
  if (/^[^\s",(){}\[\]]+@[^\s",(){}\[\]]+$/.test(mail)) who.push(`attendees.cs.[{"email":"${mail}"}]`);
  const { data, error } = await client.from("meetings")
    .select("identity_key, lease_expires_at, agent_last_recording")
    .eq("agent_last_recording", true)
    .gt("lease_expires_at", nowIso)
    .or(who.join(","));
  if (error) {
    console.error("recorded-now: не прочитать встречи", error.message);
    return [];
  }
  return recordedNowKeys((data ?? []) as RecordedNowRow[], nowIso);
}
