// Снимок календаря для пропусков автозапуска (T164, решение D023): когда снимать, что из дня
// календаря попадает в снимок и как по снимку видно пропуск идущей встречи.
//
// Ядро: ошибка молчалива. Снимок не в тот час (или сдвинутый переводом часов) — рекордер весь день
// смотрит на вчерашний календарь; встреча, выпавшая из снимка, — человек не узнает, что бот не придёт;
// лишняя — «бот не пришёл» на обед. Поэтому каждая граница — тестом.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import {
  endOfTeamDay,
  ongoingFromSnapshot,
  SNAPSHOT_HOURS,
  snapshotChecked,
  snapshotDue,
  snapshotEvents,
  type SnapshotRun,
} from "./calendar-snapshot.ts";

const PERSON = 111;
// 10:00 по Белграду летом (CEST, UTC+2).
const START_MS = Date.parse("2026-09-28T08:00:00Z");
const MEET = "https://meet.google.com/abc-defg-hij";

function ev(uid: string, startMin: number, endMin: number, extra: Partial<GEvent> = {}): GEvent {
  const at = (min: number) => new Date(START_MS + min * 60_000).toISOString();
  return {
    id: uid,
    iCalUID: uid,
    summary: uid,
    status: "confirmed",
    start: { dateTime: at(startMin) },
    end: { dateTime: at(endMin) },
    organizer: { self: true }, // своя встреча без гостей — «да» (D024)
    ...extra,
  } as GEvent;
}

const DAY: GEvent[] = [
  ev("meet", 0, 60, { hangoutLink: MEET }),
  ev("zoom", 0, 60, { location: "https://us02web.zoom.us/j/123456789" }),
  ev("badlink", 0, 60, { hangoutLink: "https://meet.google.com/" }),
  ev("lunch", 0, 60),
  ev("declined", 0, 60, {
    hangoutLink: "https://meet.google.com/dec-line-abc",
    attendees: [{ email: "me@example.com", self: true, responseStatus: "declined" }],
  }),
  ev("cancelled", 0, 60, { hangoutLink: "https://meet.google.com/can-cell-abc", status: "cancelled" }),
  { id: "allday", summary: "allday", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } } as GEvent,
  ev("evening", 480, 540, { hangoutLink: "https://meet.google.com/eve-ning-abc" }),
];

Deno.test("снимок — утром, через три часа и ещё через час, по часам Белграда", () => {
  assertEquals([...SNAPSHOT_HOURS], [8, 11, 12]);
  const summer = (utcHour: number) => Date.parse(`2026-09-28T${String(utcHour).padStart(2, "0")}:00:00Z`);
  // Лето: Белград = UTC+2.
  assertEquals(
    [5, 6, 7, 8, 9, 10, 11].map((h) => snapshotDue(summer(h))),
    [false, true, false, false, true, true, false],
  );
  // Зима (после 25.10.2026): Белград = UTC+1 — тот же местный час, другой час UTC.
  const winter = (utcHour: number) => Date.parse(`2026-11-02T${String(utcHour).padStart(2, "0")}:00:00Z`);
  assertEquals([6, 7, 8, 10, 11, 12].map((h) => snapshotDue(winter(h))), [false, true, false, true, true, false]);
  // Весь час слота, а не только его первая минута: cron мог опоздать.
  assert(snapshotDue(Date.parse("2026-09-28T06:59:00Z")));
});

Deno.test("конец дня — полночь по Белграду, и в день перевода часов тоже", () => {
  assertEquals(new Date(endOfTeamDay(Date.parse("2026-09-28T10:00:00Z"))).toISOString(), "2026-09-28T22:00:00.000Z");
  // 00:30 по Белграду 29-го — это уже 29-е.
  assertEquals(new Date(endOfTeamDay(Date.parse("2026-09-28T22:30:00Z"))).toISOString(), "2026-09-29T22:00:00.000Z");
  // 25.10.2026 в 03:00 часы переводятся назад. В 00:30 того же дня ещё лето (UTC+2), а полночь
  // 26-го — уже зима: 23:00 UTC. Смещение «сейчас» дало бы 22:00.
  assertEquals(new Date(endOfTeamDay(Date.parse("2026-10-24T22:30:00Z"))).toISOString(), "2026-10-25T23:00:00.000Z");
  // Весной (29.03.2026) — наоборот: в 00:30 зима, полночь 30-го — лето, 22:00 UTC.
  assertEquals(new Date(endOfTeamDay(Date.parse("2026-03-28T23:30:00Z"))).toISOString(), "2026-03-29T22:00:00.000Z");
});

Deno.test("в снимок идёт весь день: ожидаемые встречи и громкие причины, не встречи бота — нет", () => {
  const rows = snapshotEvents(DAY, PERSON);
  assertEquals(
    rows.map((r) => `${r.calendar_key}:${r.outcome}`),
    [
      "meet:2026-09-28:expected",
      "zoom:2026-09-28:unsupported_platform",
      "badlink:2026-09-28:unrecognized_link",
      "evening:2026-09-28:expected",
    ],
  );
  const meet = rows[0];
  assertEquals(meet.join_url, MEET);
  assertEquals(meet.platform, "meet");
  assertEquals(meet.starts_at, new Date(START_MS).toISOString());
  assertEquals(meet.ends_at, new Date(START_MS + 60 * 60_000).toISOString());
  // Ссылку туда, куда бот не ходит, не храним: звать по ней некого.
  assertEquals(rows[1].join_url, null);
  assertEquals(rows[1].platform, "zoom");
});

Deno.test("по снимку: идущая встреча — ожидаемая или пропуск, прошедшая и будущая — ничего", () => {
  const rows = snapshotEvents(
    [...DAY, ev("over", -60, 0, { hangoutLink: "https://meet.google.com/ove-rrrr-abc" })],
    PERSON,
  );
  const plan = ongoingFromSnapshot(rows, PERSON, START_MS + 30 * 60_000, new Set());
  assertEquals(plan.jobs.map((j) => `${j.title}:${j.join_url}`), [`meet:${MEET}`]);
  assertEquals(plan.jobs[0].invited_by, PERSON);
  assertEquals(
    plan.misses.map((m) => `${m.title}:${m.reason}:${m.invited_by}`),
    [`zoom:unsupported_platform:${PERSON}`, `badlink:unrecognized_link:${PERSON}`],
  );
  // Граница: в момент начала — уже идёт, в момент конца — уже нет.
  assertEquals(ongoingFromSnapshot(rows, PERSON, START_MS, new Set()).jobs.length, 1);
  assertEquals(ongoingFromSnapshot(rows, PERSON, START_MS + 60 * 60_000, new Set()).jobs.length, 0);
});

Deno.test("комната, куда уже позвали руками, — не ожидаемая встреча", () => {
  const rows = snapshotEvents([ev("meet", 0, 60, { hangoutLink: MEET })], PERSON);
  const plan = ongoingFromSnapshot(rows, PERSON, START_MS + 60_000, new Set(["meet.google.com/abc-defg-hij"]));
  assertEquals(plan, { jobs: [], misses: [] });
});

Deno.test("проверено — только если календарь сегодня прочитан или ответ про человека окончательный", () => {
  const now = Date.parse("2026-09-28T10:00:00Z");
  const run = (over: Partial<SnapshotRun>): SnapshotRun => ({
    snapshot_at: "2026-09-28T06:00:00Z",
    attempted_at: "2026-09-28T06:00:00Z",
    outcome: "ok",
    ...over,
  });
  assertEquals(snapshotChecked(null, now), false);
  assertEquals(snapshotChecked(run({}), now), true);
  // Утренний снимок есть, дневная попытка — Google моргнул: утренний снимок в силе.
  assertEquals(
    snapshotChecked(run({ attempted_at: "2026-09-28T09:00:00Z", outcome: "calendar_unavailable" }), now),
    true,
  );
  // Снимок вчерашний (по Белграду 28-е началось в 22:00 UTC 27-го) — сегодня календаря не видели.
  assertEquals(
    snapshotChecked(
      run({
        snapshot_at: "2026-09-27T21:59:00Z",
        attempted_at: "2026-09-28T06:00:00Z",
        outcome: "calendar_unavailable",
      }),
      now,
    ),
    false,
  );
  assertEquals(snapshotChecked(run({ snapshot_at: null, outcome: "calendar_unavailable" }), now), false);
  // Календаря нет или токен умер — это и есть ответ, пропуск записан.
  assertEquals(snapshotChecked(run({ snapshot_at: null, outcome: "calendar_not_connected" }), now), true);
  assertEquals(snapshotChecked(run({ snapshot_at: null, outcome: "calendar_token_dead" }), now), true);
  // …но вчерашний такой ответ сегодня уже не ответ.
  assertEquals(
    snapshotChecked(
      run({ snapshot_at: null, attempted_at: "2026-09-27T06:00:00Z", outcome: "calendar_token_dead" }),
      now,
    ),
    false,
  );
});
