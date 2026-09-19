import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  formatRecentChanges,
  formatTaskHistory,
  formatTaskStats,
  type JournalRow,
  type RecentChangeRow,
} from "./analytics-format.ts";
import type { TaskStats } from "../../_shared/tasks/analytics.ts";

const stats = (over: Partial<TaskStats> = {}): TaskStats => ({
  sinceISO: "2026-09-02T12:00:00.000Z",
  createdInPeriod: 5, closedInPeriod: 3,
  leadTimeAvgDays: 2.5, leadTimeMedianDays: 2,
  onTimeRate: 0.67, onTimeBase: 3,
  openNow: 7, inProgressNow: 2, overdueNow: 1,
  closedByAssignee: [{ name: "Вася", count: 2 }, { name: "Аня", count: 1 }],
  oldestOpenDays: 12.5,
  bucket: "day",
  createdByBucket: [{ key: "2026-09-03", count: 3 }, { key: "2026-09-04", count: 2 }],
  closedByBucket: [{ key: "2026-09-05", count: 3 }],
  ...over,
});

Deno.test("formatTaskStats: числа периода и текущая картина на месте", () => {
  const out = formatTaskStats(stats(), { label: "week" });
  assertStringIncludes(out, "Создано: 5");
  assertStringIncludes(out, "Закрыто: 3");
  assertStringIncludes(out, "просрочено 1");
  assertStringIncludes(out, "2.5 дн");
  assertStringIncludes(out, "67%");
  assertStringIncludes(out, "Вася — 2");
});

Deno.test("formatTaskStats: пустой lead time НЕ печатается нулём — иначе «закрывали мгновенно»", () => {
  const out = formatTaskStats(stats({ leadTimeAvgDays: null, leadTimeMedianDays: null, closedInPeriod: 0, closedByAssignee: [] }), { label: "week" });
  assertStringIncludes(out, "нет закрытых задач");
  assert(!out.includes("в среднем 0"), out);
});

Deno.test("formatTaskStats: без дедлайнов честно сказано, что считать не на чем", () => {
  const out = formatTaskStats(stats({ onTimeRate: null, onTimeBase: 0 }), { label: "month" });
  assertStringIncludes(out, "считать не на чем");
});

Deno.test("formatTaskStats: выдача предупреждает, чего в данных ещё нет", () => {
  const out = formatTaskStats(stats(), { label: "week", scope: "исполнитель: Вася" });
  assertStringIncludes(out, "исполнитель: Вася");
  assertStringIncludes(out, "Журнал перемещений ведётся");
});

const j = (over: Partial<JournalRow> = {}): JournalRow => ({
  field: "status", old_value: "open", new_value: "in_progress",
  author: "Вася", created_at: "2026-09-09T07:15:00.000Z", ...over,
});

Deno.test("formatTaskHistory: перевод полей на человеческий и переход со стрелкой", () => {
  const out = formatTaskHistory([j(), j({ field: "due_date", old_value: "2026-09-10", new_value: "2026-09-17" })]);
  assertStringIncludes(out, "статус: open → in_progress");
  assertStringIncludes(out, "срок: 2026-09-10 → 2026-09-17");
});

Deno.test("formatTaskHistory: пустая история говорит, почему пустая", () => {
  const out = formatTaskHistory([], { title: "Задача" });
  assertStringIncludes(out, "изменений не записано");
  assertStringIncludes(out, "Журнал перемещений ведётся");
});

Deno.test("formatTaskHistory: снятое значение печатается прочерком, а не «null»", () => {
  const out = formatTaskHistory([j({ field: "due_date", old_value: "2026-09-10", new_value: null })]);
  assertStringIncludes(out, "срок: 2026-09-10 → —");
  assert(!out.includes("null"), out);
});

const rc = (over: Partial<RecentChangeRow> = {}): RecentChangeRow => ({
  ...j(), task_id: "8e1c1d4a-1f3b-4a5c-9e77-2b0d5f6a7c88", task_title: "Починить дайджест", ...over,
});

Deno.test("formatRecentChanges: группировка по задаче, id один раз на задачу", () => {
  const out = formatRecentChanges([rc(), rc({ field: "priority", old_value: null, new_value: "high" })], { sinceISO: "2026-09-02T00:00:00.000Z" });
  assertEquals(out.split("id: 8e1c1d4a-1f3b-4a5c-9e77-2b0d5f6a7c88").length - 1, 1);
  assertStringIncludes(out, "2 в 1 задачах");
});

Deno.test("formatRecentChanges: обрезанная выдача признаётся в этом", () => {
  const out = formatRecentChanges([rc()], { sinceISO: "2026-09-02T00:00:00.000Z", truncated: true });
  assertStringIncludes(out, "обрезана");
});

Deno.test("formatRecentChanges: пусто — с оговоркой про дату старта журнала", () => {
  const out = formatRecentChanges([], { sinceISO: "2026-09-02T00:00:00.000Z" });
  assertStringIncludes(out, "нет");
  assertStringIncludes(out, "Журнал перемещений ведётся");
});

// ── Срезы по времени и время работы (решение владельца 09.09.2026) ───────────────────────────

Deno.test("formatTaskStats: раскладка по дням печатает создано / закрыто по каждой дате", () => {
  const out = formatTaskStats(stats(), { label: "week" });
  assertStringIncludes(out, "Раскладка по дням");
  assertStringIncludes(out, "2026-09-03: 3 / 0");
  assertStringIncludes(out, "2026-09-05: 0 / 3");
});

Deno.test("formatTaskStats: длинное окно подписано месяцами", () => {
  const out = formatTaskStats(stats({ bucket: "month", createdByBucket: [{ key: "2026-08", count: 4 }], closedByBucket: [{ key: "2026-08", count: 2 }] }), { label: "quarter" });
  assertStringIncludes(out, "Раскладка по месяцам");
  assertStringIncludes(out, "2026-08: 4 / 2");
});

Deno.test("formatTaskStats: время работы печатает basis — по скольким задачам считали", () => {
  const out = formatTaskStats(stats(), {
    label: "week",
    flow: { basis: 7, cycleAvgDays: 3.2, cycleMedianDays: 2, timeToStartAvgDays: 1.5, timeToStartMedianDays: 1 },
  });
  assertStringIncludes(out, "по журналу, 7 задач");
  assertStringIncludes(out, "ждала начала работы: в среднем 1.5 дн");
  assertStringIncludes(out, "в работе до закрытия: в среднем 3.2 дн");
});

Deno.test("formatTaskStats: журнал пуст — сказано прямо, а не средним по нулю задач", () => {
  const out = formatTaskStats(stats(), {
    label: "week",
    flow: { basis: 0, cycleAvgDays: null, cycleMedianDays: null, timeToStartAvgDays: null, timeToStartMedianDays: null },
  });
  assertStringIncludes(out, "считать не на чем");
  assert(!out.includes("в среднем null"), out);
});

Deno.test("formatTaskStats: упёрлись в потолок выборки — выдача предупреждает, что посчитано не по всем", () => {
  const out = formatTaskStats(stats(), { label: "year", capped: true });
  assertStringIncludes(out, "НЕ ПО ВСЕМ");
});
