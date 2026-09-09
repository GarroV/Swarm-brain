// Итоги спринта — чистой функцией, без базы: их считают один раз в момент приёмки и больше
// никогда не пересчитывают, поэтому цена ошибки высокая (цифру нельзя «переоткрыть»).
import { assertEquals } from "jsr:@std/assert@1";
import { computeSprintStats, type SprintItemView } from "./sprint-stats.ts";

function item(over: Partial<SprintItemView> = {}): SprintItemView {
  return {
    in_plan: true,
    status: "open",
    assignees: ["Марина"],
    project: "Открытие точки",
    completed_at: null,
    ...over,
  };
}

Deno.test("пустой спринт: нули и ноль процентов, а не деление на ноль", () => {
  const s = computeSprintStats([]);
  assertEquals(s.plan, 0);
  assertEquals(s.planDone, 0);
  assertEquals(s.planPercent, 0);
  assertEquals(s.byPerson, []);
});

Deno.test("процент считается от плана, взятое сверх плана в него не входит", () => {
  const s = computeSprintStats([
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ status: "done", completed_at: "2026-09-11T09:00:00Z" }),
    item({ status: "in_progress" }),
    item({ status: "open" }),
    item({ in_plan: false, status: "done", completed_at: "2026-09-12T09:00:00Z" }),
    item({ in_plan: false, status: "open" }),
  ]);
  assertEquals(s.plan, 4);
  assertEquals(s.planDone, 2);
  assertEquals(s.planPercent, 50);
  assertEquals(s.extra, 2);
  assertEquals(s.extraDone, 1);
});

Deno.test("незакрытое на момент приёмки считается перенесённым", () => {
  const s = computeSprintStats([
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ status: "in_progress" }),
    item({ in_plan: false, status: "backlog" }),
  ]);
  assertEquals(s.carried, 2);
});

Deno.test("cancelled — тоже закрытая: работа над ней кончилась", () => {
  const s = computeSprintStats([item({ status: "cancelled", completed_at: "2026-09-10T09:00:00Z" })]);
  assertEquals(s.planDone, 1);
  assertEquals(s.carried, 0);
});

Deno.test("задача на двоих попадает в строку каждого, но в общий итог — один раз", () => {
  const s = computeSprintStats([
    item({ assignees: ["Марина", "Тимур"], status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ assignees: ["Тимур"], status: "open" }),
  ]);
  assertEquals(s.plan, 2);
  assertEquals(s.planDone, 1);
  assertEquals(s.byPerson, [
    { name: "Тимур", plan: 2, done: 1 },
    { name: "Марина", plan: 1, done: 1 },
  ]);
});

Deno.test("задачи без исполнителя не создают пустую строку, а считаются отдельно", () => {
  const s = computeSprintStats([
    item({ assignees: [], status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ assignees: ["Марина"], status: "open" }),
  ]);
  assertEquals(s.unassigned, 1);
  assertEquals(s.byPerson, [{ name: "Марина", plan: 1, done: 0 }]);
});

Deno.test("разрез по проектам: задача без проекта остаётся видимой строкой null", () => {
  const s = computeSprintStats([
    item({ project: "Поставщики", status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ project: "Поставщики", status: "open" }),
    item({ project: null, status: "open" }),
  ]);
  assertEquals(s.byProject, [
    { name: "Поставщики", total: 2, done: 1 },
    { name: null, total: 1, done: 0 },
  ]);
});

Deno.test("закрытия раскладываются по дням — это и есть «когда сделали»", () => {
  const s = computeSprintStats([
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ status: "done", completed_at: "2026-09-10T18:30:00Z" }),
    item({ status: "done", completed_at: "2026-09-12T08:00:00Z" }),
    item({ status: "done", completed_at: null }), // закрыта до появления completed_at
  ]);
  assertEquals(s.byDay, [
    { day: "2026-09-10", done: 2 },
    { day: "2026-09-12", done: 1 },
  ]);
});

Deno.test("процент округляется до целого", () => {
  const s = computeSprintStats([
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ status: "open" }),
    item({ status: "open" }),
  ]);
  assertEquals(s.planPercent, 33);
});
