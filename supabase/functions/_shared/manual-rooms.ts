// Комнаты, куда бота уже позвали руками (D017) и он туда действительно едет или уже пишет.
// Одно правило на двоих: автозапуск (meeting-calendar — второго бота в такую комнату не ведёт) и
// сигнал «бот не пришёл» (meeting-missed — по такой комнате молчит). Пока у каждой функции был свой
// запрос, они разошлись: пропуск глушило любое приглашение за 12 часов, даже истёкшее или давно
// отработанное, — и утренний ручной стендап прятал вечерний «бот не пришёл» в той же комнате.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type BotRecordingRow, botStillRecording } from "./bot-recording.ts";
import { parseInviteLink } from "./meeting-invite.ts";

export interface ManualInviteRow {
  join_url: string;
  used_at: string | null;
  expires_at: string;
  /** Встреча, заведённая по приглашению (meeting_invites.meeting_id), если оно погашено. */
  meetings: BotRecordingRow | null;
}

/**
 * Сколько назад смотреть приглашения. Живое живёт 15 минут (INVITE_TTL_MS), погашенное занимает
 * комнату, пока бот пишет; встречи дольше полусуток не бывают.
 */
export const MANUAL_INVITE_LOOKBACK_MS = 12 * 60 * 60_000;

/** Приглашение держит комнату: ждёт бота (не погашено и не истекло) или бот по нему пишет сейчас. */
export function inviteCoversRoom(row: ManualInviteRow, nowMs: number): boolean {
  if (row.used_at === null) return Date.parse(row.expires_at) > nowMs;
  return row.meetings !== null && botStillRecording(row.meetings, new Date(nowMs).toISOString());
}

/** Комнаты (`parseInviteLink().room`) покрывающих приглашений; кривая ссылка не комната. */
export function coveredRooms(rows: readonly ManualInviteRow[], nowMs: number): Set<string> {
  const rooms = new Set<string>();
  for (const r of rows) {
    if (!inviteCoversRoom(r, nowMs)) continue;
    const room = parseInviteLink(r.join_url)?.room;
    if (room !== undefined) rooms.add(room);
  }
  return rooms;
}

/** Занятые ручными приглашениями комнаты воркспейса. Сбой базы — исключение: пусто ≠ «не звали». */
export async function loadCoveredRooms(supabase: SupabaseClient, groupId: string, nowMs: number): Promise<Set<string>> {
  const { data, error } = await supabase.from("meeting_invites")
    .select("join_url, used_at, expires_at, meetings(lease_expires_at, agent_last_recording)")
    .eq("group_id", groupId)
    .gte("created_at", new Date(nowMs - MANUAL_INVITE_LOOKBACK_MS).toISOString());
  if (error) throw new Error(`meeting_invites: ${error.message}`);
  return coveredRooms((data ?? []) as unknown as ManualInviteRow[], nowMs);
}
