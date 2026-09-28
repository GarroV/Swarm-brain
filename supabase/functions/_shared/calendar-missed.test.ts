// Пропуски автозапуска по календарю (T102, решения D015/D022): что считается пропуском, под каким
// ключом он хранится и когда рекордер может позвать бота руками.
//
// Ядро: ошибка здесь молчалива в обе стороны. Лишний пропуск — рекордер зовёт человека «бот не пришёл»
// на обед или на встречу, куда бот уже идёт, и человек перестаёт этому верить; потерянный — человек не
// узнаёт, что бот не придёт, и обнаруживает пустую запись. Поэтому каждая причина и граница — тестом.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { DispatchJob, DispatchSkip } from "./calendar-dispatch.ts";
import {
  ARRIVAL_GRACE_MS,
  arrivalCheckDue,
  type ArrivalJob,
  canInvite,
  MISS_REASONS,
  missFromSkip,
  missMessage,
  notArrivedMiss,
  PICKUP_GRACE_MS,
  pickupMiss,
} from "./calendar-missed.ts";

const PERSON = 111;
const KEY = "uid-1@google.com:2026-09-28";
const STARTS = "2026-09-28T10:00:00+02:00";
const ENDS = "2026-09-28T11:00:00+02:00";
const START_MS = Date.parse(STARTS);
const MEET = "https://meet.google.com/abc-defg-hij";

function skip(reason: DispatchSkip["reason"], extra: Partial<DispatchSkip> = {}): DispatchSkip {
  if (reason.startsWith("calendar_")) return { invited_by: PERSON, calendar_key: null, title: null, reason, ...extra };
  return {
    invited_by: PERSON,
    calendar_key: KEY,
    title: "Weekly sync",
    reason,
    starts_at: STARTS,
    ends_at: ENDS,
    ...extra,
  };
}

Deno.test("не пропуск: нет ссылки (обед, встреча вживую), отклонил, уже позвали руками, Google моргнул", () => {
  for (const reason of ["no_conference_link", "declined", "manual_invite_exists", "calendar_unavailable"] as const) {
    assertEquals(missFromSkip(skip(reason), START_MS), null, reason);
  }
});

Deno.test("пропуск встречи хранится под ключом встречи, со временем и площадкой", () => {
  const m = missFromSkip(skip("unsupported_platform", { platform: "zoom" }), START_MS);
  assertEquals(m, {
    invited_by: PERSON,
    miss_key: KEY,
    calendar_key: KEY,
    reason: "unsupported_platform",
    title: "Weekly sync",
    join_url: null,
    platform: "zoom",
    starts_at: STARTS,
    ends_at: ENDS,
  });
});

Deno.test("причина уровня человека — один пропуск в сутки по дате Белграда, у каждой причины свой", () => {
  const late = Date.parse("2026-09-28T23:30:00+02:00");
  const dead = missFromSkip(skip("calendar_token_dead"), late);
  const none = missFromSkip(skip("calendar_not_connected"), late);
  assertEquals(dead?.miss_key, "autojoin:2026-09-28");
  assertEquals(none?.miss_key, "autojoin:2026-09-28");
  assertEquals(dead?.reason, "calendar_token_dead");
  assertEquals(dead?.calendar_key, null);
  // 00:30 по Белграду — это ещё 28-е по UTC, но уже новые сутки команды.
  const nextDay = missFromSkip(skip("calendar_token_dead"), Date.parse("2026-09-29T00:30:00+02:00"));
  assertEquals(nextDay?.miss_key, "autojoin:2026-09-29");
});

Deno.test("причина встречи без ключа встречи — сбой отбора, а не пропуск без счёта", () => {
  assertEquals(missFromSkip(skip("unrecognized_link", { calendar_key: null }), START_MS), null);
});

const TAKEN = START_MS - 60_000;

function job(extra: Partial<ArrivalJob> = {}): ArrivalJob {
  return {
    calendar_key: KEY,
    invited_by: PERSON,
    title: "Weekly sync",
    join_url: MEET,
    platform: "meet",
    starts_at: STARTS,
    ends_at: ENDS,
    taken_at: new Date(TAKEN).toISOString(),
    ...extra,
  };
}

Deno.test("дошёл ли бот, спрашиваем не раньше запаса после забора и не после конца встречи", () => {
  assertEquals(arrivalCheckDue(job(), TAKEN + ARRIVAL_GRACE_MS - 1), false);
  assertEquals(arrivalCheckDue(job(), TAKEN + ARRIVAL_GRACE_MS), true);
  assertEquals(arrivalCheckDue(job(), Date.parse(ENDS)), false);
  assertEquals(arrivalCheckDue(job({ taken_at: null }), TAKEN + ARRIVAL_GRACE_MS), false);
});

Deno.test("бот пишет или сам сказал человеку, почему не зашёл, — пропуска нет", () => {
  assertEquals(notArrivedMiss(job(), { botSeen: true, noticeSent: false }), null);
  assertEquals(notArrivedMiss(job(), { botSeen: false, noticeSent: true }), null);
});

Deno.test("бот не дошёл и промолчал — пропуск со ссылкой, по нему можно позвать руками", () => {
  const m = notArrivedMiss(job(), { botSeen: false, noticeSent: false });
  assertEquals(m?.reason, "not_arrived");
  assertEquals(m?.miss_key, KEY);
  assertEquals(m?.join_url, MEET);
  assertEquals(m?.ends_at, ENDS);
  assert(m !== null && canInvite(m));
});

const dispatchJob: DispatchJob = {
  calendar_key: KEY,
  invited_by: PERSON,
  join_url: MEET,
  platform: "meet",
  title: "Weekly sync",
  starts_at: STARTS,
  ends_at: ENDS,
};

Deno.test("задания нет или никто не забрал — служба автозапуска не отозвалась, но не раньше запаса", () => {
  const due = START_MS + PICKUP_GRACE_MS;
  assertEquals(pickupMiss(dispatchJob, null, due - 1), null);
  assertEquals(pickupMiss(dispatchJob, null, due)?.reason, "not_picked_up");
  assertEquals(pickupMiss(dispatchJob, { taken_at: null }, due)?.reason, "not_picked_up");
  assertEquals(pickupMiss(dispatchJob, { taken_at: new Date(START_MS).toISOString() }, due), null);
  assertEquals(pickupMiss(dispatchJob, null, Date.parse(ENDS)), null);
  const m = pickupMiss(dispatchJob, null, due);
  assert(m !== null && canInvite(m) && m.join_url === MEET);
});

Deno.test("позвать руками можно только туда, куда бот умеет и где есть ссылка", () => {
  for (const reason of MISS_REASONS) {
    const base = { ...notArrivedMiss(job(), { botSeen: false, noticeSent: false })!, reason };
    assertEquals(canInvite(base), reason === "not_arrived" || reason === "not_picked_up", reason);
  }
  const noLink = { ...notArrivedMiss(job(), { botSeen: false, noticeSent: false })!, join_url: null };
  assertEquals(canInvite(noLink), false);
});

Deno.test("у каждой причины текст на обоих языках, название встречи в нём, пустого нет", () => {
  for (const reason of MISS_REASONS) {
    const m = { ...notArrivedMiss(job(), { botSeen: false, noticeSent: false })!, reason };
    const text = missMessage(m);
    assert(text.en.length > 20 && text.ru.length > 20, reason);
    if (m.calendar_key !== null && !reason.startsWith("calendar_")) {
      assertStringIncludes(text.en, "Weekly sync");
      assertStringIncludes(text.ru, "Weekly sync");
    }
  }
  const untitled = missMessage({ ...notArrivedMiss(job(), { botSeen: false, noticeSent: false })!, title: null });
  assertStringIncludes(untitled.en, "untitled meeting");
  assertStringIncludes(untitled.ru, "встреча без названия");
});
