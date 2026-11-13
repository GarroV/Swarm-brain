// Кому бот сообщает о провале записи: принявшие встречу (решение владельца 12.11.2026). Источник
// «принял» у человека с подключённым календарём — его собственный календарь, а не событие
// запустившего: там статус можно вписать импортом .ics.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import {
  acceptedInOwnCalendar,
  type CalendarAccess,
  MAX_CALENDAR_CHECKS,
  type NoticeJob,
  resolveNoticeRecipients,
} from "./notice-recipients.ts";

const MEET = "https://meet.google.com/abc-defg-hij";
const OTHER_MEET = "https://meet.google.com/zzz-zzzz-zzz";

const JOB: NoticeJob = {
  invited_by: 1,
  join_url: MEET,
  starts_at: "2026-09-28T07:01:00Z",
  ends_at: "2026-09-28T07:30:00Z",
  attendee_emails: ["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io", "f@x.io"],
  accepted_emails: ["a@x.io", "b@x.io", "c@x.io"],
};

/** Событие в календаре человека: его собственный ответ — `response`. */
function own(response: string, over: Partial<GEvent> = {}): GEvent {
  return {
    id: "e",
    start: { dateTime: "2026-09-28T07:01:00Z" },
    end: { dateTime: "2026-09-28T07:30:00Z" },
    hangoutLink: MEET,
    organizer: { email: "boss@x.io" },
    attendees: [{ email: "me@x.io", self: true, responseStatus: response }],
    ...over,
  };
}

/** Календари: id → события, `null` — календаря нет, `"boom"` — Google не ответил. */
function calendars(byId: Record<number, GEvent[] | null | "boom">): CalendarAccess {
  return {
    ownEvents: (id) => {
      const entry = byId[id] ?? null;
      if (entry === "boom") return Promise.reject(new Error("Google 500"));
      return Promise.resolve(entry);
    },
  };
}

const members = [
  { telegram_id: 2, email: "A@x.io" }, // без календаря, accepted в событии запустившего
  { telegram_id: 3, email: "b@x.io" }, // календарь есть; в событии запустившего «accepted» (подделка?), у себя needsAction
  { telegram_id: 4, email: "c@x.io" }, // календарь есть; у себя accepted
  { telegram_id: 5, email: "d@x.io" }, // без календаря, needsAction в событии запустившего
  { telegram_id: 6, email: "e@x.io" }, // календарь есть, Google упал
  { telegram_id: -9, email: "f@x.io" }, // веб без Telegram
  { telegram_id: 1, email: "boss@x.io" }, // запустивший — отдельно, всегда
  { telegram_id: 8, email: "stranger@x.io" }, // не гость события
];

Deno.test("БЛОКИРУЮЩИЙ: подделанный «accepted» в событии запустившего не даёт нотис тому, у кого календарь подключён и он НЕ принял", async () => {
  const got = await resolveNoticeRecipients(JOB, members, calendars({ 3: [own("needsAction")] }));
  assertEquals(got.includes(3), false);
});

Deno.test("БЛОКИРУЮЩИЙ: принявший в СВОЁМ календаре получает, даже если в событии запустившего он needsAction", async () => {
  const job = { ...JOB, attendee_emails: ["c@x.io"], accepted_emails: [] };
  const got = await resolveNoticeRecipients(job, members, calendars({ 4: [own("accepted")] }));
  assertEquals(got, [4]);
});

Deno.test("БЛОКИРУЮЩИЙ: без календаря — по ответу в событии запустившего: accepted получает, needsAction нет", async () => {
  const job = { ...JOB, attendee_emails: ["a@x.io", "d@x.io"], accepted_emails: ["a@x.io"] };
  const got = await resolveNoticeRecipients(job, members, calendars({}));
  assertEquals(got, [2]);
});

Deno.test("сводно: принявшие в своих календарях и без календаря; запустивший, веб без Telegram, не гости, не принявшие — нет", async () => {
  const got = await resolveNoticeRecipients(
    JOB,
    members,
    calendars({ 3: [own("tentative")], 4: [own("accepted")], 6: "boom" }),
  );
  assertEquals(got, [2, 4]);
});

Deno.test("Google упал по одному человеку — он не попадает, остальные получены, ошибка не летит наружу и пишется в лог", async () => {
  const lines: string[] = [];
  const got = await resolveNoticeRecipients(
    JOB,
    members,
    calendars({ 4: [own("accepted")], 6: "boom" }),
    (l) => lines.push(l),
  );
  assertEquals(got.includes(6), false);
  assertEquals(got.includes(4), true);
  assertEquals(lines.length, 1);
});

Deno.test("событие в календаре другой комнаты, другого времени, отменённое или отклонённое — «принял» не засчитывается", () => {
  const job = { join_url: MEET, starts_at: JOB.starts_at, ends_at: JOB.ends_at };
  assertEquals(acceptedInOwnCalendar([own("accepted")], job), true);
  assertEquals(acceptedInOwnCalendar([own("accepted", { hangoutLink: OTHER_MEET })], job), false);
  assertEquals(
    acceptedInOwnCalendar(
      [own("accepted", { start: { dateTime: "2026-09-28T09:00:00Z" }, end: { dateTime: "2026-09-28T09:30:00Z" } })],
      job,
    ),
    false,
  );
  assertEquals(acceptedInOwnCalendar([own("accepted", { status: "cancelled" })], job), false);
  assertEquals(acceptedInOwnCalendar([own("declined")], job), false);
  assertEquals(acceptedInOwnCalendar([own("accepted", { hangoutLink: undefined })], job), false);
});

Deno.test("встреча на десятки гостей: календарей читается не больше предела, остальные — по событию запустившего", async () => {
  const many = Array.from(
    { length: MAX_CALENDAR_CHECKS + 5 },
    (_, n) => ({ telegram_id: 100 + n, email: `p${n}@x.io` }),
  );
  const emails = many.map((m) => m.email);
  let reads = 0;
  const got = await resolveNoticeRecipients(
    { ...JOB, attendee_emails: emails, accepted_emails: emails },
    many,
    {
      ownEvents: () => {
        reads += 1;
        return Promise.resolve(null);
      },
    },
  );
  assertEquals(reads, MAX_CALENDAR_CHECKS);
  assertEquals(got.length, many.length);
});
