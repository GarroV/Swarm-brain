// События календаря на сегодня — одно чтение для панели «Встречи сегодня» (swarm-api)
// и MCP-брифинга (issue #517). Причины пустоты различаются намеренно (урок #175):
// `not_connected` и `token_expired` — человеку надо подключить календарь, `calendar_error` —
// временная запинка Google, переподключаться не надо (issue #302).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accessToken, listEvents } from "./google-calendar.ts";
import { dayBounds } from "./meetings-today.ts";
import type { GEvent } from "../meeting-current/select.ts";

type Db = Pick<SupabaseClient, "from">;

export type CalendarGap = "not_connected" | "token_expired" | "calendar_error";

const TODAY_EVENTS_LIMIT = 25;

export async function todayCalendarEvents(
  db: Db,
  telegramId: number,
  tzOffsetMinutes: number,
  now: Date = new Date(),
): Promise<{ ok: true; events: GEvent[] } | { ok: false; reason: CalendarGap }> {
  const { data: integ } = await db
    .from("user_integrations").select("api_key")
    .eq("telegram_id", telegramId).eq("service", "google_calendar")
    .maybeSingle();
  const refresh = (integ as { api_key?: string } | null)?.api_key;
  if (!refresh) return { ok: false, reason: "not_connected" };

  const tok = await accessToken(refresh);
  if (!tok.ok) return { ok: false, reason: tok.deadGrant ? "token_expired" : "calendar_error" };

  const { timeMin, timeMax } = dayBounds(now.toISOString(), Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0);
  const events = await listEvents(tok.token, timeMin, timeMax, TODAY_EVENTS_LIMIT);
  if (!events) return { ok: false, reason: "calendar_error" };
  return { ok: true, events };
}
