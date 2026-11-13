// Исходы заходов бота встреч scriba (issue #1244): чистая часть — какие исходы бывают, как из
// нотисы и из «не пойдёт» календаря получается строка, и запись в таблицу scriba_join_outcomes
// (канон схемы — migrations/20261113130000_scriba_join_outcomes.sql). Решений о людях здесь нет:
// запись молчаливая для человека, ничего не отправляет.
//
// Пишет сервер там, где исход и так приходит: meeting-notice (нотиса бота) и meeting-calendar
// (опрос календаря). Сбой записи не роняет вызывающего: нотиса и задания боту важнее учёта, а
// потерянная строка видна в логе функции.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { DispatchSkip, SkipReason } from "./calendar-dispatch.ts";
import type { NoticeKind } from "./notices.ts";

/** Исходы из нотис контейнера. */
export const NOTICE_OUTCOMES = [
  "door_denied",
  "door_blocked",
  "door_timeout",
  "guest_access_closed",
  "meeting_unavailable",
  "account_signin_required",
  "captcha",
  "no_conference_link",
  "no_owner",
  "no_audio",
  "recording_lost",
  "container_died",
  "join_failed",
] as const;

/** Исходы из «не пойдёт» на опросе календаря — те же слова, что SkipReason. */
export const SKIP_OUTCOMES = [
  "unsupported_platform",
  "unrecognized_link",
  "declined",
  "not_accepted",
  "manual_invite_exists",
  "calendar_not_connected",
  "calendar_token_dead",
  "calendar_unavailable",
] as const satisfies readonly SkipReason[];

export type JoinOutcome = (typeof NOTICE_OUTCOMES)[number] | (typeof SKIP_OUTCOMES)[number];

/** Все исходы — таблица принимает ровно их (check в миграции; сверяет db-тест). */
export const JOIN_OUTCOMES: readonly JoinOutcome[] = [...NOTICE_OUTCOMES, ...SKIP_OUTCOMES];

export interface OutcomeRecord {
  group_id: string;
  invited_by: number;
  meeting_id: string | null;
  calendar_key: string | null;
  outcome: JoinOutcome;
  source: "notice" | "calendar";
  outcome_key: string;
  detail: string | null;
}

/**
 * Какой исход несёт нотиса. `null` — промежуточная («жду у двери», «стучусь»), исхода в ней нет.
 * Record по всем видам: новый вид нотисы без решения здесь не соберётся.
 */
const NOTICE_TO_OUTCOME: Readonly<Record<NoticeKind, JoinOutcome | null>> = {
  door_waiting: null,
  door_denied: "door_denied",
  door_blocked: "door_blocked",
  guest_access_closed: "guest_access_closed",
  guest_access_waiting: null,
  meeting_unavailable: "meeting_unavailable",
  account_signin_required: "account_signin_required",
  captcha: "captcha",
  no_conference_link: "no_conference_link",
  no_owner: "no_owner",
  no_audio: "no_audio",
  recording_lost: "recording_lost",
  container_died: "container_died",
  join_failed: "join_failed",
};

export function outcomeOfNotice(kind: NoticeKind, shouldLeave: boolean): JoinOutcome | null {
  // «Жду у двери» с ответом «уходи» — это и есть «не впустили за отведённое время».
  if (kind === "door_waiting") return shouldLeave ? "door_timeout" : null;
  return NOTICE_TO_OUTCOME[kind];
}

/** Строки исходов по «не пойдёт» опроса календаря. Причины уровня человека — раз в час. */
export function outcomesFromSkips(
  groupId: string,
  skipped: readonly DispatchSkip[],
  nowMs: number,
): OutcomeRecord[] {
  const hour = new Date(nowMs).toISOString().slice(0, 13);
  return skipped.map((s) => ({
    group_id: groupId,
    invited_by: s.invited_by,
    meeting_id: null,
    calendar_key: s.calendar_key,
    outcome: s.reason,
    source: "calendar" as const,
    outcome_key: s.calendar_key ?? `person:${hour}`,
    detail: null,
  }));
}

export interface OutcomeStore {
  /** Записать исходы; уже записанные (человек + ключ + исход) не трогаются. Бросает при сбое базы. */
  record(rows: readonly OutcomeRecord[]): Promise<void>;
}

export function makeOutcomeStore(supabase: SupabaseClient): OutcomeStore {
  return {
    async record(rows) {
      if (rows.length === 0) return;
      const { error } = await supabase.from("scriba_join_outcomes").upsert(
        [...rows],
        { onConflict: "invited_by,outcome_key,outcome", ignoreDuplicates: true },
      );
      if (error) throw new Error(`scriba_join_outcomes insert: ${error.message}`);
    },
  };
}

/** Записать, не бросая: сбой — громко в лог, вызывающий продолжает. */
export async function recordOutcomes(
  store: OutcomeStore,
  rows: readonly OutcomeRecord[],
  log: (line: string) => void,
): Promise<void> {
  try {
    await store.record(rows);
  } catch (e) {
    log(`исходы заходов бота не записаны (${rows.length}): ${e instanceof Error ? e.message : String(e)}`);
  }
}
