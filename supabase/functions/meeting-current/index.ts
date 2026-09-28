// «Какая встреча идёт сейчас» для рекордера — по серверной Google-интеграции.
// Agent-токен (smcp_) → telegram_id → refresh_token из user_integrations → access_token →
// Google Calendar API (события now−2мин…now+LOOKAHEAD_MIN) → идущие созвоны → идентичность для claim.
// Ответ: `{ meetings: [...], meeting: meetings[0] | null, reason? }` — только события со ссылкой на
// созвон известной площадки (D026), пересекающиеся — все, лучший первым (D027).
// Рекордеру не нужен ни macOS-Календарь, ни доступ к календарю на маке.
//
// Деплой: supabase functions deploy meeting-current --no-verify-jwt (хитит рекордер с Bearer smcp_).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveActingIdentity } from "../_shared/agent-auth.ts";
import { currentEvents, type GEvent } from "./select.ts";
import { type ConferenceCall, conferenceCall, type ConferenceInfo, conferenceInfo } from "./join-link.ts";
// Ключ встречи собирается там же, где его сверяет meeting-claim (issue #545).
import { calendarKeyOf } from "../_shared/calendar-key.ts";
// Обмен refresh→access и запрос событий — общий модуль (его же зовёт swarm-api для панели
// «Встречи сегодня», issue #218). Здесь своей копии больше нет.
import { accessToken, listEvents } from "../_shared/google-calendar.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// За сколько минут до начала встреча считается «предстоящей» и рекордер предлагает запись.
const LOOKAHEAD_MIN = 5;
// Ответ по одному событию. У капсулы ссылка есть всегда: события без созвона в `meetings` не
// попадают (D026); без неё сюда приходит только событие пропуска бота (см. grantMeeting).
function meetingOf(ev: GEvent, link: ConferenceCall | ConferenceInfo) {
  const attendees = (ev.attendees ?? [])
    .map((a) => ({ name: a.displayName ?? null, email: a.email ?? null }))
    .filter((a) => a.name || a.email);
  return {
    identity_kind: "calendar",
    // currentEvents отдаёт только события со временем начала, поэтому ключ здесь всегда есть.
    identity_key: calendarKeyOf(ev)!,
    title: ev.summary ?? null,
    attendees,
    started_at: ev.start!.dateTime,
    ended_at: ev.end!.dateTime,
    // Ссылка «зайти в звонок» (#193) и площадка — по ней бот выбирает адаптер захода.
    ...link,
  };
}

// «Встречи нет» и почему. Оба поля: `meetings` — новый рекордер (D027), `meeting` — раскатанный.
function none(reason: string): Response {
  return json({ meetings: [], meeting: null, reason });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Бот с пропуском (T165) видит ровно событие пропуска — капсульный отбор D026/D027 его не касается:
// событие без ссылки приходит с `reason: "no_conference_link"`, по нему бот говорит человеку, почему
// не пришёл (meeting-notice). В `meetings` оно попадает, только если это созвон.
function grantMeeting(items: GEvent[], calendarKey: string | null): Response {
  const ev = items.find((e) => e.start?.dateTime !== undefined && calendarKeyOf(e) === calendarKey);
  if (!ev) return none("no_ongoing_event");
  const call = conferenceCall(ev);
  const meeting = meetingOf(ev, call ?? conferenceInfo(ev));
  return json({ meetings: call ? [meeting] : [], meeting });
}

Deno.serve(async (req: Request) => {
  let identity;
  try {
    identity = await resolveActingIdentity(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ error: e.message }, 401);
    throw e;
  }

  // Бот видит только событие своего пропуска (T165): пропуск задания — это событие и ничего
  // больше из календаря человека, пропуск приглашения — календаря не открывает вовсе.
  const grant = identity.kind === "bot" ? identity.grant ?? null : null;
  if (identity.kind === "bot" && grant?.basis !== "calendar") {
    return none("no_ongoing_event");
  }

  const { data } = await supabase.from("user_integrations")
    .select("api_key").eq("telegram_id", identity.telegramId).eq(
      "service",
      "google_calendar",
    ).maybeSingle();
  const refresh = (data as { api_key?: string } | null)?.api_key;
  if (!refresh) return none("google_not_connected");

  const tok = await accessToken(refresh);
  // `token_refresh_failed` (→ рекордер просит переподключить календарь) — ТОЛЬКО когда Google
  // подтвердил, что refresh_token реально мёртв (invalid_grant/invalid_client). Временный сбой
  // (429/5xx/сеть) — та же ветка, что ошибка Calendar API: рекордер её не показывает как «мёртво».
  if (!tok.ok) {
    return none(tok.deadGrant ? "token_refresh_failed" : "calendar_api_error");
  }
  const token = tok.token;

  const now = new Date();
  // Окно: чуть назад (идущая) + вперёд на LOOKAHEAD_MIN (предстоящая, для упреждающего «через N мин»).
  // Порог упреждения задаёт ТОЛЬКО сервер: рекордер показывает «через N мин» по тому, что пришло
  // (AppDelegate.swift, meetingSubtitle) — своего порога у него нет. Было 10 мин, с 04.09.2026 — 5
  // (решение владельца: «есть запрос на уведомление о встрече за 5 минут, а не за десять»).
  const timeMin = new Date(now.getTime() - 2 * 60_000).toISOString();
  const timeMax = new Date(now.getTime() + LOOKAHEAD_MIN * 60_000)
    .toISOString();
  const items = await listEvents(token, timeMin, timeMax, 10);
  if (!items) return none("calendar_api_error");
  if (grant) return grantMeeting(items, grant.calendarKey);
  // Только созвоны (D026): слот, заглушка, напоминание без ссылки на Meet/Толк/Zoom капсулу не
  // зовут — для них есть уведомления Google. Пересекающиеся созвоны — все, списком (D027): капсула
  // даёт выбор, а не берёт одно молча. Порядок — лучший первым (скоринг по RSVP, см. select.ts).
  const calls = new Map<GEvent, ConferenceCall>();
  for (const ev of items) {
    const call = conferenceCall(ev);
    if (call) calls.set(ev, call);
  }
  const meetings = currentEvents(items, now.getTime(), (ev) => calls.has(ev))
    .map((ev) => meetingOf(ev, calls.get(ev)!));
  // `meeting` — первое из списка, для раскатанных рекордеров, которые знают только одно поле.
  if (!meetings.length) return none("no_ongoing_event");
  return json({ meetings, meeting: meetings[0] });
});
