// Хранилище пропусков автозапуска (T102) на supabase-js (service_role). Решений здесь нет — только
// запросы; что считается пропуском, решает _shared/calendar-missed.ts. Общее у meeting-calendar
// (пишет на опросе оркестратора) и meeting-missed (пишет и читает на опросе рекордера). Держит этот
// файл смоук scripts/scriba-calendar-smoke.ts против настоящего Postgres.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ArrivalEvidence, ArrivalJob, MissRecord } from "./calendar-missed.ts";

/** Задание календаря, как его видит проверка «дошёл ли бот». */
export interface JobRow extends ArrivalJob {
  id: string;
  arrival_checked_at: string | null;
}

/** Пропуск, как его отдаёт база. */
export interface MissRow extends MissRecord {
  id: string;
  group_id: string;
  detected_at: string;
  invite_id: string | null;
}

export interface MissStore {
  /** Записать пропуски; уже записанные (человек + ключ + причина) не трогаются. */
  recordMisses(groupId: string, misses: readonly MissRecord[]): Promise<void>;
  /** Забранные задания воркспейса без итога проверки «дошёл ли бот», у которых встреча ещё идёт. */
  arrivalCandidates(groupId: string, nowIso: string): Promise<JobRow[]>;
  markArrivalChecked(jobId: string, nowIso: string): Promise<void>;
  /** Задания воркспейса на эти встречи. */
  jobsFor(groupId: string, calendarKeys: readonly string[]): Promise<JobRow[]>;
  /**
   * Бот подал heartbeat в строку этой встречи · человеку `recipient` по ней ушла нотиса бота.
   */
  arrivalEvidence(groupId: string, calendarKey: string, recipient: number): Promise<ArrivalEvidence>;
}

const JOB_COLUMNS =
  "id, calendar_key, invited_by, title, join_url, platform, starts_at, ends_at, taken_at, arrival_checked_at";
export const MISS_COLUMNS =
  "id, group_id, invited_by, miss_key, calendar_key, reason, title, join_url, platform, starts_at, ends_at, detected_at, invite_id";

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T | null {
  // Ошибка чтения — громко: пустой список выглядит ровно как «пропусков нет».
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function makeMissStore(supabase: SupabaseClient): MissStore {
  return {
    async recordMisses(groupId, misses) {
      if (misses.length === 0) return;
      must(
        "meeting_calendar_misses insert",
        await supabase.from("meeting_calendar_misses").upsert(
          misses.map((m) => ({ ...m, group_id: groupId })),
          { onConflict: "invited_by,miss_key,reason", ignoreDuplicates: true },
        ),
      );
    },
    async arrivalCandidates(groupId, nowIso) {
      const res = await supabase.from("meeting_calendar_jobs").select(JOB_COLUMNS)
        .eq("group_id", groupId).not("taken_at", "is", null).is("arrival_checked_at", null).gt("ends_at", nowIso);
      return (must("meeting_calendar_jobs arrival", res) ?? []) as JobRow[];
    },
    async markArrivalChecked(jobId, nowIso) {
      must(
        "meeting_calendar_jobs arrival_checked_at",
        await supabase.from("meeting_calendar_jobs").update({ arrival_checked_at: nowIso })
          .eq("id", jobId).is("arrival_checked_at", null),
      );
    },
    async jobsFor(groupId, calendarKeys) {
      if (calendarKeys.length === 0) return [];
      const res = await supabase.from("meeting_calendar_jobs").select(JOB_COLUMNS)
        .eq("group_id", groupId).in("calendar_key", [...calendarKeys]);
      return (must("meeting_calendar_jobs by key", res) ?? []) as JobRow[];
    },
    async arrivalEvidence(groupId, calendarKey, recipient) {
      const meetings = (must(
        "meetings",
        await supabase.from("meetings").select("id, agent_last_seen_at")
          .eq("group_id", groupId).eq("identity_key", calendarKey),
      ) ?? []) as { id: string; agent_last_seen_at: string | null }[];
      if (meetings.some((m) => m.agent_last_seen_at !== null)) return { botSeen: true, noticeSent: false };
      // Бот сам сказал человеку: по строке встречи (дверь, join_failed) или по ключу календаря
      // (до-встречные нотисы).
      const byKey = must(
        "meeting_notices by key",
        await supabase.from("meeting_notices").select("id")
          .eq("recipient_id", recipient).eq("status", "sent").eq("meeting_key", calendarKey).limit(1),
      ) ?? [];
      if (byKey.length > 0) return { botSeen: false, noticeSent: true };
      if (meetings.length === 0) return { botSeen: false, noticeSent: false };
      const byMeeting = must(
        "meeting_notices by meeting",
        await supabase.from("meeting_notices").select("id")
          .eq("recipient_id", recipient).eq("status", "sent").in("meeting_id", meetings.map((m) => m.id)).limit(1),
      ) ?? [];
      return { botSeen: false, noticeSent: byMeeting.length > 0 };
    },
  };
}
