import { assertEquals } from "jsr:@std/assert@1";
import { computeFlowTimes, computeTaskStats, periodStartISO, type StatsTask } from "./analytics.ts";

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

// ── Раскладка по времени: «сколько закрыто в день/месяц» (решение владельца 09.09.2026) ──────

Deno.test("computeTaskStats: короткое окно раскладывается по ДНЯМ", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "done", created_at: "2026-09-03T10:00:00Z", completed_at: "2026-09-05T10:00:00Z" }),
    task({ id: "b", status: "done", created_at: "2026-09-03T11:00:00Z", completed_at: "2026-09-05T18:00:00Z" }),
    task({ id: "c", status: "done", created_at: "2026-09-04T11:00:00Z", completed_at: "2026-09-07T09:00:00Z" }),
  ], { sinceISO: SINCE, now: NOW });
  assertEquals(s.bucket, "day");
  assertEquals(s.closedByBucket, [{ key: "2026-09-05", count: 2 }, { key: "2026-09-07", count: 1 }]);
  assertEquals(s.createdByBucket, [{ key: "2026-09-03", count: 2 }, { key: "2026-09-04", count: 1 }]);
});

Deno.test("computeTaskStats: длинное окно — по МЕСЯЦАМ (иначе 365 строк в выдаче)", () => {
  const s = computeTaskStats([
    task({ id: "a", status: "done", created_at: "2026-07-03T10:00:00Z", completed_at: "2026-07-05T10:00:00Z" }),
    task({ id: "b", status: "done", created_at: "2026-08-03T10:00:00Z", completed_at: "2026-08-06T10:00:00Z" }),
    task({ id: "c", status: "done", created_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-02T10:00:00Z" }),
  ], { sinceISO: "2026-06-11T12:00:00.000Z", now: NOW });
  assertEquals(s.bucket, "month");
  assertEquals(s.closedByBucket, [{ key: "2026-07", count: 1 }, { key: "2026-08", count: 1 }, { key: "2026-09", count: 1 }]);
});

// ── Время работы с задачами по журналу ───────────────────────────────────────────────────────

Deno.test("computeFlowTimes: берёт ПЕРВЫЙ переход в работу, даже если их было несколько", () => {
  const f = computeFlowTimes([
    { task_id: "a", new_value: "in_progress", created_at: "2026-09-04T00:00:00Z" },
    { task_id: "a", new_value: "open", created_at: "2026-09-05T00:00:00Z" },
    { task_id: "a", new_value: "in_progress", created_at: "2026-09-06T00:00:00Z" },
  ], [task({ id: "a", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-08T00:00:00Z" })]);
  assertEquals(f.basis, 1);
  assertEquals(f.timeToStartAvgDays, 1);   // 03 → 04, а не 03 → 06
  assertEquals(f.cycleAvgDays, 4);         // 04 → 08
});

Deno.test("computeFlowTimes: задачи без перехода в работу в расчёт не идут — basis это показывает", () => {
  const f = computeFlowTimes([], [
    task({ id: "a", status: "done", created_at: "2026-09-03T00:00:00Z", completed_at: "2026-09-08T00:00:00Z" }),
  ]);
  assertEquals([f.basis, f.cycleAvgDays, f.timeToStartAvgDays], [0, null, null]);
});

Deno.test("computeFlowTimes: незакрытая задача даёт время ожидания, но не cycle time", () => {
  const f = computeFlowTimes(
    [{ task_id: "a", new_value: "in_progress", created_at: "2026-09-05T00:00:00Z" }],
    [task({ id: "a", status: "in_progress", created_at: "2026-09-03T00:00:00Z" })],
  );
  assertEquals([f.timeToStartAvgDays, f.cycleAvgDays], [2, null]);
});
