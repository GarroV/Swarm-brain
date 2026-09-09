import { assertEquals } from "jsr:@std/assert@1";
import { computeTaskStats, periodStartISO, type StatsTask } from "./analytics.ts";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const SINCE = "2026-09-02T12:00:00.000Z";

const task = (t: Partial<StatsTask> & { id: string; status: string }): StatsTask => t;

Deno.test("computeTaskStats: считает создано/закрыто ТОЛЬКО внутри окна", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "done", created_at: "2026-09-03T10:00:00Z", completed_at: "2026-09-05T10:00:00Z" }),
    task({ id: "b", status: "done", created_at: "2026-08-01T10:00:00Z", completed_at: "2026-08-02T10:00:00Z" }),
    task({ id: "c", status: "open", created_at: "2026-09-04T10:00:00Z" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals([s.createdInPeriod, s.closedInPeriod], [2, 1]);
});

Deno.test("computeTaskStats: lead time в днях — среднее и медиана", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-05T00:00:00Z" }),
    task({ id: "b", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-07T00:00:00Z" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals([s.leadTimeAvgDays, s.leadTimeMedianDays], [3, 3]);
});

Deno.test("computeTaskStats: без закрытых задач lead time = null, а не 0 (0 соврал бы «мгновенно»)", () => {
  const s = computeTaskStats([task({ id: "a", status: "open", created_at: "2026-09-04T00:00:00Z" })], { sinceISO: SINCE, now: NOW });
  assertEquals([s.leadTimeAvgDays, s.leadTimeMedianDays, s.onTimeRate], [null, null, null]);
});

Deno.test("computeTaskStats: в срок = закрыта не позже дня дедлайна", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-05T18:00:00Z", due_date: "2026-09-05" }),
    task({ id: "b", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-08T00:00:00Z", due_date: "2026-09-05" }),
    task({ id: "c", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-08T00:00:00Z" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals([s.onTimeRate, s.onTimeBase], [0.5, 2]);
});

Deno.test("computeTaskStats: просрочка по календарю — срок «сегодня» ещё не просрочен", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "open", due_date: "2026-09-09" }),
    task({ id: "b", status: "open", due_date: "2026-09-08" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals(s.overdueNow, 1);
});

Deno.test("computeTaskStats: закрытые по исполнителям, по убыванию; закрытая задача не в openNow", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "done", completed_at: "2026-09-05T00:00:00Z", assignees: ["Аня"] }),
    task({ id: "b", status: "done", completed_at: "2026-09-06T00:00:00Z", assignees: ["Вася"] }),
    task({ id: "c", status: "done", completed_at: "2026-09-07T00:00:00Z", assignees: ["Вася"] }),
    task({ id: "d", status: "in_progress" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals(s.closedByAssignee, [{ name: "Вася", count: 2 }, { name: "Аня", count: 1 }]);
  assertEquals([s.openNow, s.inProgressNow], [1, 1]);
});

Deno.test("computeTaskStats: возраст самой старой незакрытой", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "open", created_at: "2026-09-04T12:00:00Z" }),
    task({ id: "b", status: "backlog", created_at: "2026-08-30T12:00:00Z" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals(s.oldestOpenDays, 10);
});

Deno.test("periodStartISO: известные слова считаются, неизвестное — null (вызывающий обязан отказать)", () => {
  assertEquals(periodStartISO("week", NOW), "2026-09-02T12:00:00.000Z");
  assertEquals(periodStartISO("month", NOW), "2026-08-10T12:00:00.000Z");
  assertEquals(periodStartISO("вчера", NOW), null);
});
