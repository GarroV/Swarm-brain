// События календаря на сегодня — одно чтение для панели «Встречи сегодня» (swarm-api)
// и MCP-брифинга (issue #517). Причины пустоты различаются намеренно (урок #175):
// `not_connected` и `token_expired` — человеку надо подключить календарь, `calendar_error` —
// временная запинка Google, переподключаться не надо (issue #302).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accessToken, dropCachedToken, listEventsResult } from "./google-calendar.ts";
import { dayBounds } from "./meetings-today.ts";
import type { GEvent } from "../meeting-current/select.ts";

type Db = Pick<SupabaseClient, "from">;

export type CalendarGap = "not_connected" | "token_expired" | "calendar_error";

const TODAY_EVENTS_LIMIT = 25;

/** Обращения к Google — подменяются в тесте. */
export type CalendarDeps = {
  accessToken: typeof accessToken;
  dropCachedToken: typeof dropCachedToken;
  listEventsResult: typeof listEventsResult;
};

export async function todayCalendarEvents(
  db: Db,
  telegramId: number,
  tzOffsetMinutes: number,
  now: Date = new Date(),
  deps: CalendarDeps = { accessToken, dropCachedToken, listEventsResult },
): Promise<{ ok: true; events: GEvent[] } | { ok: false; reason: CalendarGap }> {
  const { data: integ } = await db
    .from("user_integrations").select("api_key")
    .eq("telegram_id", telegramId).eq("service", "google_calendar")
    .maybeSingle();
  const refresh = (integ as { api_key?: string } | null)?.api_key;
  if (!refresh) return { ok: false, reason: "not_connected" };

  const { timeMin, timeMax } = dayBounds(now.toISOString(), Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0);
  const list = (token: string) => deps.listEventsResult(token, timeMin, timeMax, TODAY_EVENTS_LIMIT);

  const tok = await deps.accessToken(refresh);
  if (!tok.ok) return { ok: false, reason: tok.deadGrant ? "token_expired" : "calendar_error" };

  let res = await list(tok.token);
  if (!res.ok && res.status === 401) {
    // Кэшированный access-токен отозван раньше срока (#906): сбрасываем и пробуем один раз со свежим.
    await deps.dropCachedToken(refresh);
    const fresh = await deps.accessToken(refresh);
    if (!fresh.ok) return { ok: false, reason: fresh.deadGrant ? "token_expired" : "calendar_error" };
    res = await list(fresh.token);
  }
  if (!res.ok) return { ok: false, reason: "calendar_error" };
  return { ok: true, events: res.events };
}
