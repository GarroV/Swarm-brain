// Живая проверка календаря для автозапуска бота (решение владельца 01.10.2026, канон —
// docs/decisions/2026-10-01-autojoin-calendar-check.md): «проверяй именно есть ли встречи и доступ к
// ним, а не просто виден ли коннектор».
//
// Строка в user_integrations значит лишь, что когда-то календарь подключали. Отзыв доступа, смена
// пароля, снятая галочка календаря на экране Google — и строка на месте, а бот не узнает ни об одной
// встрече. Поэтому проверка — тем же путём, каким ходит обход автозапуска (meeting-calendar):
// обмен токена, запрос событий на неделю вперёд, отбор встреч по тому же правилу (joinVerdict).
//
// Статусы:
//   not_connected — токена календаря нет вовсе;
//   no_access     — токен отозван/протух (invalid_grant) или Google отказал в событиях 401/403;
//   unavailable   — Google не ответил или ответил сбоем: проверить не вышло, звать переподключаться
//                   нельзя (урок #302 — призыв на каждый чих Google);
//   no_meetings   — доступ есть, но за неделю нет ни одной встречи, на которую бот пойдёт;
//   ok            — такие встречи есть: сколько и какая ближайшая.
import type { EventsResult, TokenResult } from "./google-calendar.ts";
import type { GEvent } from "../meeting-current/select.ts";
import type { ConferencePlatform } from "../meeting-current/join-link.ts";
import { joinVerdict } from "./calendar-dispatch.ts";

/** На сколько дней вперёд смотрим. Неделя — горизонт, в котором у работающего человека есть встречи. */
export const AUTOJOIN_CHECK_DAYS = 7;
// Google отдаёт до 2500 за запрос; неделе живого календаря хватает с запасом, обрезка лишь занижает N.
const MAX_EVENTS = 250;

export type AutojoinCalendarStatus = "not_connected" | "no_access" | "unavailable" | "no_meetings" | "ok";

export interface AutojoinCalendarCheck {
  status: AutojoinCalendarStatus;
  /** Встреч, на которые бот пойдёт, за неделю. */
  meetings: number;
  /** Событий со временем за неделю — чтобы отличить «календарь пуст» от «встречи есть, но не те». */
  events: number;
  /** Ближайшая встреча, на которую бот пойдёт. Только из календаря самого человека. */
  next: { title: string | null; starts_at: string; platform: ConferencePlatform } | null;
}

export interface CalendarCheckSource {
  refreshToken(): Promise<string | null>;
  accessToken(refresh: string): Promise<TokenResult>;
  listEvents(token: string, timeMin: string, timeMax: string, maxResults: number): Promise<EventsResult>;
}

const empty = (status: AutojoinCalendarStatus): AutojoinCalendarCheck => ({
  status,
  meetings: 0,
  events: 0,
  next: null,
});

/** Событие со временем, которое ещё не кончилось. На весь день и отменённые встречами бота не являются. */
function upcomingStart(ev: GEvent, nowMs: number): number | null {
  if (ev.status === "cancelled") return null;
  const start = ev.start?.dateTime;
  const end = ev.end?.dateTime;
  if (start === undefined || end === undefined) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= nowMs) return null;
  return s;
}

export async function checkAutojoinCalendar(
  source: CalendarCheckSource,
  nowMs: number,
): Promise<AutojoinCalendarCheck> {
  const refresh = await source.refreshToken();
  if (!refresh) return empty("not_connected");
  const tok = await source.accessToken(refresh);
  if (!tok.ok) return empty(tok.deadGrant ? "no_access" : "unavailable");
  const res = await source.listEvents(
    tok.token,
    new Date(nowMs).toISOString(),
    new Date(nowMs + AUTOJOIN_CHECK_DAYS * 86_400_000).toISOString(),
    MAX_EVENTS,
  );
  if (!res.ok) return empty(res.status === 401 || res.status === 403 ? "no_access" : "unavailable");

  let events = 0;
  let meetings = 0;
  let next: AutojoinCalendarCheck["next"] = null;
  let nextStart = Infinity;
  for (const ev of res.events) {
    const start = upcomingStart(ev, nowMs);
    if (start === null) continue;
    events++;
    const verdict = joinVerdict(ev);
    if (!verdict.ok) continue;
    meetings++;
    if (start < nextStart) {
      nextStart = start;
      next = { title: ev.summary ?? null, starts_at: ev.start!.dateTime!, platform: verdict.link.platform };
    }
  }
  return { status: meetings > 0 ? "ok" : "no_meetings", meetings, events, next };
}
