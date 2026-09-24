import { assertEquals } from "jsr:@std/assert";
import {
  ACTIVITY_DAYS,
  computePeopleStats,
  lastDays,
  teamDay,
} from "./people.ts";

// пт 25.09.2026, 14:00 по Белграду (UTC+2).
const NOW = new Date("2026-09-25T12:00:00Z");
const A = { telegram_id: 1, name: "Аня" };
const B = { telegram_id: 2, name: "Борис" };

function run(over: Partial<Parameters<typeof computePeopleStats>[0]>) {
  return computePeopleStats({
    members: [A, B],
    tasks: [],
    meetings: [],
    reviewCounts: null,
    events: [],
    now: NOW,
    ...over,
  });
}

Deno.test("teamDay: 00:30 по Белграду — уже новый день, хотя в UTC ещё вчера", () => {
  assertEquals(teamDay("2026-09-24T22:30:00Z"), "2026-09-25");
});

Deno.test("lastDays: 14 дней подряд, сегодня последним, без дыр через смену времени", () => {
  const d = lastDays(new Date("2026-10-30T12:00:00Z"), ACTIVITY_DAYS); // 25.10 — переход на зимнее
  assertEquals(d.length, ACTIVITY_DAYS);
  assertEquals(d[ACTIVITY_DAYS - 1], "2026-10-30");
  assertEquals(d[0], "2026-10-17");
  assertEquals(new Set(d).size, ACTIVITY_DAYS);
});

Deno.test("задачи: открытые, в работе, просроченные; общая задача засчитана обоим исполнителям", () => {
  const [a, b] = run({
    tasks: [
      { status: "open", due_date: "2026-09-20", assignee_telegram_ids: [1, 2] },
      {
        status: "in_progress",
        due_date: "2026-09-25",
        assignee_telegram_ids: [1],
      },
      { status: "backlog", assignee_telegram_ids: [1] },
      { status: "open", assignee_telegram_ids: [99] }, // не участник воркспейса
    ],
  });
  assertEquals([a.tasks.open, a.tasks.inProgress, a.tasks.overdue], [2, 1, 1]);
  assertEquals([b.tasks.open, b.tasks.overdue], [1, 1]);
});

Deno.test("задачи: закрытые за 30 дней, доля в срок и среднее время закрытия", () => {
  const [a] = run({
    tasks: [
      // в срок: закрыта 24.09, срок 25.09, жила 4 дня
      {
        status: "done",
        created_at: "2026-09-20T10:00:00Z",
        completed_at: "2026-09-24T10:00:00Z",
        due_date: "2026-09-25",
        assignee_telegram_ids: [1],
      },
      // опоздала: закрыта 00:30 26.09 по Белграду при сроке 25.09 — UTC сказал бы «в срок»
      {
        status: "done",
        created_at: "2026-09-23T22:30:00Z",
        completed_at: "2026-09-25T22:30:00Z",
        due_date: "2026-09-25",
        assignee_telegram_ids: [1],
      },
      // отменена без срока — закрыта, в долю «в срок» не входит
      {
        status: "cancelled",
        created_at: "2026-09-10T10:00:00Z",
        completed_at: "2026-09-12T10:00:00Z",
        assignee_telegram_ids: [1],
      },
      // закрыта давно — в «всего», но не в окно
      {
        status: "done",
        created_at: "2026-06-01T10:00:00Z",
        completed_at: "2026-07-01T10:00:00Z",
        due_date: "2026-06-10",
        assignee_telegram_ids: [1],
      },
      // закрыта без даты закрытия — считаем закрытой, но окна не знаем
      { status: "done", assignee_telegram_ids: [1] },
    ],
  });
  assertEquals(a.tasks.closed, 5);
  assertEquals(a.tasks.closedRecent, 3);
  assertEquals([a.tasks.onTimeRate, a.tasks.onTimeBase], [0.5, 2]);
  assertEquals(a.tasks.avgCloseDays, 2.7); // (4 + 2 + 2) / 3
});

Deno.test("задачи: нет закрытых со сроком — доля null, а не 0 или 100%", () => {
  const [a] = run({ tasks: [{ status: "open", assignee_telegram_ids: [1] }] });
  assertEquals([a.tasks.onTimeRate, a.tasks.avgCloseDays], [null, null]);
});

Deno.test("встречи: опубликованные по автору; «на вычитке» — только если выдано", () => {
  const meetings = [{ author: 1 }, { author: 1 }, { author: null }, {
    author: 2,
  }];
  const [a, b] = run({ meetings });
  assertEquals([a.meetings.published, b.meetings.published], [2, 1]);
  assertEquals(a.meetings.inReview, null);
  const [a2, b2] = run({ meetings, reviewCounts: new Map([[1, 3]]) });
  assertEquals([a2.meetings.inReview, b2.meetings.inReview], [3, 0]);
});

Deno.test("активность: дни с действиями, полоска по дням и последнее действие", () => {
  const [a, b] = run({
    events: [
      { telegram_id: 1, at: "2026-09-25T08:00:00Z" },
      { telegram_id: 1, at: "2026-09-25T09:00:00Z" },
      { telegram_id: 1, at: "2026-09-24T22:30:00Z" }, // 00:30 25.09 по Белграду
      { telegram_id: 1, at: "2026-09-20T10:00:00Z" },
      { telegram_id: 1, at: "2026-08-01T10:00:00Z" }, // вне полоски, но не последнее
      { telegram_id: 2, at: "2026-08-01T10:00:00Z" }, // только давно
      { telegram_id: 1, at: "not-a-date" },
    ],
  });
  assertEquals(a.activity.activeDays, 2);
  assertEquals(a.activity.strip[ACTIVITY_DAYS - 1], 3);
  assertEquals(a.activity.strip[ACTIVITY_DAYS - 6], 1);
  assertEquals(a.activity.lastActiveAt, "2026-09-25T09:00:00Z");
  assertEquals([b.activity.activeDays, b.activity.lastActiveAt], [
    0,
    "2026-08-01T10:00:00Z",
  ]);
});

Deno.test("участник без единой строки получает нули, а не выпадает из списка", () => {
  const got = run({});
  assertEquals(got.map((p) => p.name), ["Аня", "Борис"]);
  assertEquals(got[1].tasks.open, 0);
  assertEquals(got[1].activity.strip.length, ACTIVITY_DAYS);
});
