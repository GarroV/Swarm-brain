// Кого и о чём будит пропуск автозапуска по календарю (T102, решение D015).
//
// Ядро: ошибка здесь молчалива в обе стороны. Лишний «громкий» пропуск — человек получает сообщение о
// каждом обеде в календаре и перестаёт читать сигналы бота вообще; потерянный — человек не узнаёт, что
// бот не придёт, и обнаруживает пустую запись. Поэтому каждая причина и каждая граница — тестом.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { DispatchSkip } from "./calendar-dispatch.ts";
import { ARRIVAL_GRACE_MS, arrivalCheckDue, type ArrivalJob, notArrivedNotice, skipNotice } from "./calendar-missed.ts";

const PERSON = 111;
const KEY = "uid-1@google.com:2026-09-28";
/** 10:00 по Белграду (UTC+2 в сентябре). */
const DAY = Date.parse("2026-09-28T08:00:00Z");

function skip(reason: DispatchSkip["reason"], extra: Partial<DispatchSkip> = {}): DispatchSkip {
  const personLevel = reason.startsWith("calendar_");
  return {
    invited_by: PERSON,
    calendar_key: personLevel ? null : KEY,
    title: personLevel ? null : "Weekly sync",
    reason,
    ...extra,
  };
}

Deno.test("тихие причины не будят человека: нет ссылки, отклонил, уже позвали руками, Google моргнул", () => {
  for (const reason of ["no_conference_link", "declined", "manual_invite_exists", "calendar_unavailable"] as const) {
    assertEquals(skipNotice(skip(reason), DAY), null, reason);
  }
});

Deno.test("не Meet — сообщение владельцу календаря о ЭТОЙ встрече, площадка названа, совет — рекордер", () => {
  const n = skipNotice(skip("unsupported_platform", { platform: "zoom" }), DAY);
  assert(n !== null);
  assertEquals(n.recipient, PERSON);
  assertEquals(n.meetingKey, KEY);
  assertEquals(n.kind, "autojoin_unsupported_platform");
  assertStringIncludes(n.html, "Weekly sync");
  assertStringIncludes(n.html, "Zoom");
  assertStringIncludes(n.html, "bumblebee");
});

Deno.test("ссылка не разобралась — подсказка позвать бота руками, на обоих языках, английский первым", () => {
  const n = skipNotice(skip("unrecognized_link", { platform: "meet" }), DAY);
  assert(n !== null);
  assertEquals(n.kind, "autojoin_unrecognized_link");
  const en = n.html.indexOf("Invite the bot to a call");
  const ru = n.html.indexOf("Позвать бота на созвон");
  assert(en >= 0 && ru > en, n.html);
});

Deno.test("причина уровня человека — раз в сутки по дате Белграда, у каждой причины свой счёт", () => {
  const dead = skipNotice(skip("calendar_token_dead"), DAY);
  const none = skipNotice(skip("calendar_not_connected"), DAY);
  assert(dead !== null && none !== null);
  assertEquals(dead.meetingKey, "autojoin:2026-09-28");
  assertEquals(none.meetingKey, "autojoin:2026-09-28");
  assertEquals(dead.kind, "autojoin_calendar_token_dead");
  assertEquals(none.kind, "autojoin_calendar_not_connected");
  assertStringIncludes(dead.html, "Invite the bot to a call");
  assertStringIncludes(none.html, "Connections");
});

Deno.test("причина уровня человека ночью молчит: будить не о чем, встречи мы не видим", () => {
  const belgrade = (hhmm: string) => Date.parse(`2026-09-28T${hhmm}:00+02:00`);
  assertEquals(skipNotice(skip("calendar_token_dead"), belgrade("07:59")), null);
  assert(skipNotice(skip("calendar_token_dead"), belgrade("08:00")) !== null);
  assert(skipNotice(skip("calendar_token_dead"), belgrade("19:59")) !== null);
  assertEquals(skipNotice(skip("calendar_token_dead"), belgrade("20:00")), null);
  assertEquals(skipNotice(skip("calendar_token_dead"), belgrade("23:30")), null);
});

Deno.test("пропуск встречи ночью всё равно громкий: встреча-то у человека есть", () => {
  const night = Date.parse("2026-09-28T23:30:00+02:00");
  assert(skipNotice(skip("unrecognized_link"), night) !== null);
});

Deno.test("название из календаря экранируется: это чужой текст в HTML-сообщении", () => {
  const n = skipNotice(skip("unrecognized_link", { title: "<b>R&D</b>" }), DAY);
  assert(n !== null);
  assertStringIncludes(n.html, "&lt;b&gt;R&amp;D&lt;/b&gt;");
  assert(!n.html.includes("<b>R&D"), n.html);
});

Deno.test("встреча без названия не даёт пустых кавычек", () => {
  const n = skipNotice(skip("unrecognized_link", { title: null }), DAY);
  assert(n !== null);
  assertStringIncludes(n.html, "untitled meeting");
  assertStringIncludes(n.html, "встреча без названия");
});

const TAKEN = Date.parse("2026-09-28T10:00:00+02:00");

function job(extra: Partial<ArrivalJob> = {}): ArrivalJob {
  return {
    calendar_key: KEY,
    invited_by: PERSON,
    title: "Weekly sync",
    join_url: "https://meet.google.com/abc-defg-hij",
    taken_at: new Date(TAKEN).toISOString(),
    ends_at: "2026-09-28T11:00:00+02:00",
    ...extra,
  };
}

Deno.test("дошёл ли бот, спрашиваем не раньше запаса после забора и не после конца встречи", () => {
  assertEquals(arrivalCheckDue(job(), TAKEN + ARRIVAL_GRACE_MS - 1), false);
  assertEquals(arrivalCheckDue(job(), TAKEN + ARRIVAL_GRACE_MS), true);
  assertEquals(arrivalCheckDue(job(), Date.parse("2026-09-28T11:00:00+02:00")), false);
  assertEquals(arrivalCheckDue(job({ taken_at: null }), TAKEN + ARRIVAL_GRACE_MS), false);
});

Deno.test("бот пишет или уже сам сказал человеку, что не зашёл, — второго сообщения нет", () => {
  assertEquals(notArrivedNotice(job(), { botSeen: true, noticeSent: false }), null);
  assertEquals(notArrivedNotice(job(), { botSeen: false, noticeSent: true }), null);
});

Deno.test("бот не дошёл и промолчал — человеку причина, ссылка и ручной путь", () => {
  const n = notArrivedNotice(job({ join_url: "https://meet.google.com/abc-defg-hij?a=1&b=2" }), {
    botSeen: false,
    noticeSent: false,
  });
  assert(n !== null);
  assertEquals(n.recipient, PERSON);
  assertEquals(n.meetingKey, KEY);
  assertEquals(n.kind, "autojoin_not_arrived");
  assertStringIncludes(n.html, "Weekly sync");
  assertStringIncludes(n.html, "https://meet.google.com/abc-defg-hij?a=1&amp;b=2");
  assertStringIncludes(n.html, "Invite the bot to a call");
  assertStringIncludes(n.html, "Позвать бота на созвон");
});
