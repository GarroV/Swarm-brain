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
    item({
      in_plan: false,
      status: "done",
      completed_at: "2026-09-12T09:00:00Z",
    }),
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

Deno.test("отменённая не считается сделанной и никуда не едет (решение владельца 18.09.2026)", () => {
  // Раньше она шла в «сделано»: отмена задачи повышала процент выполнения, то есть отчёт
  // улучшался оттого, что работу не сделали. Теперь — отдельной цифрой, мимо процента.
  const s = computeSprintStats([
    item({ status: "cancelled", completed_at: "2026-09-10T09:00:00Z" }),
  ]);
  assertEquals(s.planDone, 0);
  assertEquals(s.cancelled, 1);
  assertEquals(s.carried, 0);
});

Deno.test("отменённая уходит и из знаменателя: две задачи, одна сделана, одна отменена — это 100%", () => {
  const s = computeSprintStats([
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ status: "cancelled" }),
  ]);
  assertEquals(s.planDone, 1);
  assertEquals(s.cancelled, 1);
  assertEquals(s.planPercent, 100);
});

Deno.test("спринт из одних отмен — ноль процентов, а не сто и не деление на ноль", () => {
  const s = computeSprintStats([
    item({ status: "cancelled" }),
    item({ status: "cancelled" }),
  ]);
  assertEquals(s.planPercent, 0);
  assertEquals(s.cancelled, 2);
});

Deno.test("отменённая не попадает в разрезы по людям и проектам", () => {
  const s = computeSprintStats([
    item({
      status: "done",
      assignees: ["Марина"],
      completed_at: "2026-09-10T09:00:00Z",
    }),
    item({ status: "cancelled", assignees: ["Марина"] }),
  ]);
  assertEquals(s.byPerson[0], { name: "Марина", plan: 1, done: 1 });
  assertEquals(s.byProject[0].total, 1);
});

Deno.test("упоминание удалённой задачи не считается нигде", () => {
  const s = computeSprintStats([
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
    item({ status: "open", removed_at: "2026-09-12T10:00:00Z" }),
  ]);
  assertEquals(s.plan, 1);
  assertEquals(s.removed, 1);
  assertEquals(s.carried, 0);
  assertEquals(s.planPercent, 100);
  assertEquals(s.byPerson.length, 1);
});

Deno.test("перенос разведён на ручной и автоматический", () => {
  const s = computeSprintStats([
    item({ status: "open", to_carry: true }),
    item({ status: "in_progress" }),
    item({ status: "done", completed_at: "2026-09-10T09:00:00Z" }),
  ]);
  assertEquals(s.carried, 2);
  assertEquals(s.carried_manual, 1);
  assertEquals(s.carried_auto, 1);
});

Deno.test("отметки сверки считаются по видам", () => {
  const s = computeSprintStats([
    item({ check_status: "ok" }),
    item({ check_status: "risk" }),
    item({ check_status: "risk" }),
    item({ check_status: "problem" }),
    item({}),
  ]);
  assertEquals(s.check_ok, 1);
  assertEquals(s.check_risk, 2);
  assertEquals(s.check_problem, 1);
});

Deno.test("задача на двоих попадает в строку каждого, но в общий итог — один раз", () => {
  const s = computeSprintStats([
    item({
      assignees: ["Марина", "Тимур"],
      status: "done",
      completed_at: "2026-09-10T09:00:00Z",
    }),
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
    item({
      assignees: [],
      status: "done",
      completed_at: "2026-09-10T09:00:00Z",
    }),
    item({ assignees: ["Марина"], status: "open" }),
  ]);
  assertEquals(s.unassigned, 1);
  assertEquals(s.byPerson, [{ name: "Марина", plan: 1, done: 0 }]);
});

Deno.test("разрез по проектам: задача без проекта остаётся видимой строкой null", () => {
  const s = computeSprintStats([
    item({
      project: "Поставщики",
      status: "done",
      completed_at: "2026-09-10T09:00:00Z",
    }),
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
