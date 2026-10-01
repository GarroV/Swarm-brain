// Живая проверка календаря для автозапуска бота (решение владельца 01.10.2026): «проверяй именно есть
// ли встречи и доступ к ним, а не просто виден ли коннектор».
//
// Ядро: статус решает, что человек увидит у переключателя, — «бот придёт» или «подключите календарь».
// Ошибка молчалива в обе стороны: «всё хорошо» при мёртвом токене — бот не придёт, и никто не узнает;
// «не подключён» при живом календаре — человек выключит бота зря. Поэтому каждая граница — тестом.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import type { EventsResult, TokenResult } from "./google-calendar.ts";
import { AUTOJOIN_CHECK_DAYS, type CalendarCheckSource, checkAutojoinCalendar } from "./autojoin-calendar.ts";

const NOW = Date.parse("2026-10-01T10:00:00Z");
const MEET = "https://meet.google.com/abc-defg-hij";

function event(over: Partial<GEvent> = {}, startMin = 60, lengthMin = 30): GEvent {
  return {
    id: "ev1",
    iCalUID: "uid1@google.com",
    summary: "Weekly",
    status: "confirmed",
    start: { dateTime: new Date(NOW + startMin * 60_000).toISOString() },
    end: { dateTime: new Date(NOW + (startMin + lengthMin) * 60_000).toISOString() },
    hangoutLink: MEET,
    organizer: { self: true },
    ...over,
  };
}

function source(
  opts: { refresh?: string | null; token?: TokenResult; events?: EventsResult },
): CalendarCheckSource & { windows: Array<[string, string]> } {
  const windows: Array<[string, string]> = [];
  return {
    windows,
    refreshToken: () => Promise.resolve(opts.refresh === undefined ? "r1" : opts.refresh),
    accessToken: () => Promise.resolve(opts.token ?? { ok: true, token: "a1" }),
    listEvents: (_t, min, max) => {
      windows.push([min, max]);
      return Promise.resolve(opts.events ?? { ok: true, events: [] });
    },
  };
}

Deno.test("нет токена календаря — not_connected, в Google не ходим", async () => {
  const s = source({ refresh: null });
  const r = await checkAutojoinCalendar(s, NOW);
  assertEquals(r.status, "not_connected");
  assertEquals(s.windows, []);
});

Deno.test("токен отозван (invalid_grant) — no_access", async () => {
  const r = await checkAutojoinCalendar(source({ token: { ok: false, deadGrant: true } }), NOW);
  assertEquals(r.status, "no_access");
});

Deno.test("временная запинка обмена токена — unavailable, а не «переподключите»", async () => {
  const r = await checkAutojoinCalendar(source({ token: { ok: false, deadGrant: false } }), NOW);
  assertEquals(r.status, "unavailable");
});

Deno.test("Google отвечает на события 401 — no_access", async () => {
  const r = await checkAutojoinCalendar(source({ events: { ok: false, status: 401 } }), NOW);
  assertEquals(r.status, "no_access");
});

Deno.test("Google отвечает на события 403 (нет права на календарь) — no_access", async () => {
  const r = await checkAutojoinCalendar(source({ events: { ok: false, status: 403 } }), NOW);
  assertEquals(r.status, "no_access");
});

Deno.test("Google отвечает 500 или не ответил — unavailable", async () => {
  assertEquals(
    (await checkAutojoinCalendar(source({ events: { ok: false, status: 500 } }), NOW)).status,
    "unavailable",
  );
  assertEquals(
    (await checkAutojoinCalendar(source({ events: { ok: false, status: null } }), NOW)).status,
    "unavailable",
  );
});

Deno.test("доступ есть, событий нет — no_meetings", async () => {
  const r = await checkAutojoinCalendar(source({}), NOW);
  assertEquals([r.status, r.meetings, r.events], ["no_meetings", 0, 0]);
});

Deno.test("события есть, но без ссылки на звонок — no_meetings, события посчитаны", async () => {
  const ev = event({ hangoutLink: undefined });
  const r = await checkAutojoinCalendar(source({ events: { ok: true, events: [ev] } }), NOW);
  assertEquals([r.status, r.meetings, r.events], ["no_meetings", 0, 1]);
});

Deno.test("встреча Meet через час, принятая, — ok, число и ближайшая", async () => {
  const later = event({ id: "ev2", iCalUID: "uid2", summary: "Later" }, 24 * 60);
  const soon = event({ summary: "Soon" }, 60);
  const r = await checkAutojoinCalendar(source({ events: { ok: true, events: [later, soon] } }), NOW);
  assertEquals([r.status, r.meetings, r.events], ["ok", 2, 2]);
  assertEquals(r.next?.title, "Soon");
  assertEquals(r.next?.starts_at, soon.start?.dateTime);
  assertEquals(r.next?.platform, "meet");
});

Deno.test("встречи, на которые бот не пойдёт, не считаются: отклонённая, без «да», отменённая, на весь день", async () => {
  const declined = event({ organizer: {}, attendees: [{ self: true, responseStatus: "declined" }] });
  const maybe = event({ organizer: {}, attendees: [{ self: true, responseStatus: "tentative" }] });
  const cancelled = event({ status: "cancelled" });
  const allDay = event({ start: { date: "2026-10-02" }, end: { date: "2026-10-03" } });
  const r = await checkAutojoinCalendar(
    source({ events: { ok: true, events: [declined, maybe, cancelled, allDay] } }),
    NOW,
  );
  assertEquals([r.status, r.meetings], ["no_meetings", 0]);
});

Deno.test("уже закончившаяся встреча не считается, идущая сейчас — считается", async () => {
  const past = event({ summary: "Past" }, -90, 30);
  const ongoing = event({ id: "ev3", iCalUID: "uid3", summary: "Now" }, -10, 30);
  const r = await checkAutojoinCalendar(source({ events: { ok: true, events: [past, ongoing] } }), NOW);
  assertEquals([r.status, r.meetings, r.next?.title], ["ok", 1, "Now"]);
});

Deno.test("окно проверки — от сейчас на неделю вперёд", async () => {
  const s = source({});
  await checkAutojoinCalendar(s, NOW);
  assertEquals(s.windows, [[
    new Date(NOW).toISOString(),
    new Date(NOW + AUTOJOIN_CHECK_DAYS * 86_400_000).toISOString(),
  ]]);
});
