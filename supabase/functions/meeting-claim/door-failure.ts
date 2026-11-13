// Бот так и не вошёл в звонок — по журналу нотис (`meeting_notices`), без новой колонки.
//
// Зачем: бот заявляется до звонка и берёт лиз; не прошёл дверь — держатель «пустой», но по арбитражу
// (arbiter.ts, `isEmptyHolder`) уступал рекордеру участника только через льготный срок
// (EMPTY_HOLDER_GRACE_SEC, 20 минут от заявки): запись появлялась на 20–40 минут позже. Бот уже
// сообщает о каждом терминальном исходе двери нотисой, и журнал знает это сразу (решение владельца
// 12.11.2026, docs/decisions/2026-11-12-bot-notices-to-all-participants.md).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOOR_MAX_ATTEMPTS } from "../_shared/notices.ts";
import { type HeldRow, holdsNothing } from "./arbiter.ts";

/**
 * Виды нотис, после которых бот уходит, не начав запись (сверено с `passDoor`/`isJoined` в
 * bot/src/orchestrator/run-meeting.ts): дверь отказала, комната закрыта, встречи нет, вход слетел,
 * капча, не удалось зайти. `door_waiting` терминален только вторым разом (потолок двери).
 * Не входят `no_audio`, `recording_lost`, `container_died`: бот был в звонке, запись могла идти.
 */
export const DOOR_TERMINAL_KINDS = [
  "door_denied",
  "door_blocked",
  "guest_access_closed",
  "meeting_unavailable",
  "account_signin_required",
  "captcha",
  "join_failed",
] as const;

export interface JournalRow {
  kind: string;
  attempt: number;
  sent_at: string;
}

/** Когда бот последний раз сообщил о терминальном исходе двери, мс; нет такой нотисы — null. */
export function latestDoorFailureMs(rows: readonly JournalRow[]): number | null {
  let latest: number | null = null;
  for (const r of rows) {
    const terminal = (DOOR_TERMINAL_KINDS as readonly string[]).includes(r.kind) ||
      (r.kind === "door_waiting" && r.attempt >= DOOR_MAX_ATTEMPTS);
    const ms = Date.parse(r.sent_at);
    if (terminal && Number.isFinite(ms) && (latest === null || ms > latest)) latest = ms;
  }
  return latest;
}

/**
 * Читает журнал ТОЛЬКО этой встречи (`meeting_id`): другая встреча человека, хоть параллельная, хоть с
 * тем же человеком, сюда не попадает. Любой статус строки, кроме удалённой: недоставка Telegram бота
 * из звонка не возвращает. Ошибка чтения — null (прежний льготный срок), громко в лог.
 */
export async function loadDoorFailureMs(client: SupabaseClient, meetingId: string): Promise<number | null> {
  const { data, error } = await client
    .from("meeting_notices")
    .select("kind, attempt, sent_at")
    .eq("meeting_id", meetingId)
    .in("kind", [...DOOR_TERMINAL_KINDS, "door_waiting"]);
  if (error) {
    console.error(`meeting-claim: журнал нотис встречи ${meetingId} не прочитан: ${error.message}`);
    return null;
  }
  return latestDoorFailureMs((data ?? []) as JournalRow[]);
}

/**
 * Для арбитража: когда бот сообщил, что не вошёл. Журнал читается, только когда это что-то меняет —
 * держатель пуст, а запись претендента с секундами; иначе null и ни одного запроса.
 */
export function doorFailure(client: SupabaseClient, row: HeldRow & { id: string }, candidate: number) {
  return candidate > 0 && holdsNothing(row) ? loadDoorFailureMs(client, row.id) : Promise.resolve(null);
}
