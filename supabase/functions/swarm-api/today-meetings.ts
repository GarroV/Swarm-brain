// Встречи дня для `GET /calendar/today` и `GET /board/today`: один код на оба маршрута,
// чтобы доска рекордера и панель главной не разошлись (docs/decisions/2026-10-22-bumblebee-hub.md).
// Причины пустоты РАЗЛИЧАЮТСЯ намеренно (урок #175) — см. комментарий у маршрута в index.ts.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type CalendarGap, todayCalendarEvents } from "../_shared/calendar-today.ts";
import { type RecorderPresence, type TodayMeeting, todayMeetings } from "../_shared/meetings-today.ts";
import { joinLink } from "../meeting-current/join-link.ts";

type Db = Pick<SupabaseClient, "from">;

export type TodayMeetingsResult =
  | { ok: true; meetings: TodayMeeting[] }
  | { ok: false; reason: CalendarGap };

/** Строка присутствия рекордера → то, что понимает todayMeetings. */
export function presenceFromRow(
  r: {
    recorder_last_seen?: string | null;
    recorder_last_recording?: boolean | null;
    recorder_last_on_call?: boolean | null;
    recorder_last_meeting_key?: string | null;
  } | null,
): RecorderPresence | null {
  return r
    ? {
      meetingKey: r.recorder_last_meeting_key ?? null,
      onCall: r.recorder_last_on_call === true,
      recording: r.recorder_last_recording === true,
      lastSeen: r.recorder_last_seen ?? null,
    }
    : null;
}

/**
 * События календаря на сутки клиента (пояс — `tzOffsetMinutes`: сервер живёт в UTC) с пометками
 * присутствия рекордера. Присутствие читается ПАРАЛЛЕЛЬНО с обменом токена и запросом к Google
 * (issue #906). Колонок присутствия может не быть, пока не накатили миграцию, — тогда панель
 * работает без ON AIR, а ошибка уходит в лог, а не глотается.
 */
export async function loadTodayMeetings(
  db: Db,
  telegramId: number,
  tzOffsetMinutes: number,
  logTag = "calendar/today",
): Promise<TodayMeetingsResult> {
  const presenceQuery = (async () =>
    await db
      .from("allowed_users")
      .select("recorder_last_seen, recorder_last_recording, recorder_last_on_call, recorder_last_meeting_key")
      .eq("telegram_id", telegramId).maybeSingle())();
  const [cal, { data: rec, error: recErr }] = await Promise.all([
    todayCalendarEvents(db, telegramId, tzOffsetMinutes),
    presenceQuery,
  ]);
  if (!cal.ok) return { ok: false, reason: cal.reason };
  if (recErr) console.warn(`[${logTag}] присутствие рекордера не прочиталось:`, recErr.message);
  const presence = presenceFromRow(rec as Parameters<typeof presenceFromRow>[0]);
  return { ok: true, meetings: todayMeetings(cal.events, new Date(), joinLink, presence) };
}
