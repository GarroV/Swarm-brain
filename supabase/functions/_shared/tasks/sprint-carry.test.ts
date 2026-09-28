// Тесты написаны до реализации: перенос хвостов — ядро (ошибка здесь молчит, потерянная
// задача просто не доедет до следующего спринта, и никто этого не заметит).
import { assertEquals } from "@std/assert";
import { type CarryInput, type CarryKind, planCarry } from "./sprint-carry.ts";

const item = (over: Partial<CarryInput> & { id: string }): CarryInput => ({
  status: "open",
  to_carry: false,
  removed_at: null,
  ...over,
});

const kindOf = (rows: readonly { id: string; kind: CarryKind }[], id: string) =>
  rows.find((r) => r.id === id)?.kind;

Deno.test("закрытая задача остаётся в спринте", () => {
  const plan = planCarry([item({ id: "a", status: "done" })]);
  assertEquals(kindOf(plan, "a"), "stay");
});

Deno.test("отменённая — тоже закрытая: работа над ней кончилась, никуда не едет", () => {
  const plan = planCarry([item({ id: "a", status: "cancelled" })]);
  assertEquals(kindOf(plan, "a"), "stay");
});

Deno.test("помеченная «к переносу» уезжает вручную", () => {
  const plan = planCarry([item({ id: "a", to_carry: true })]);
  assertEquals(kindOf(plan, "a"), "manual");
});

Deno.test("незакрытая без пометки уезжает автоматически", () => {
  const plan = planCarry([item({ id: "a", status: "in_progress" })]);
  assertEquals(kindOf(plan, "a"), "auto");
});

Deno.test("пометка у закрытой задачи игнорируется: сделанное не переносят", () => {
  const plan = planCarry([item({ id: "a", status: "done", to_carry: true })]);
  assertEquals(kindOf(plan, "a"), "stay");
});

Deno.test("упоминание удалённой задачи не переносится и не считается", () => {
  // Задача удалена, в составе осталась строка-упоминание: переносить нечего — самой задачи
  // больше нет, и «хвост» из неё сделал бы призрака в следующем спринте.
  const plan = planCarry([
    item({ id: "a", removed_at: "2026-09-18T10:00:00Z", to_carry: true }),
  ]);
  assertEquals(kindOf(plan, "a"), "mention");
});

Deno.test("статус у упоминания роли не играет — строка удалённой задачи всегда упоминание", () => {
  const plan = planCarry([
    item({ id: "a", status: "done", removed_at: "2026-09-18T10:00:00Z" }),
  ]);
  assertEquals(kindOf(plan, "a"), "mention");
});

Deno.test("backlog — незакрытый статус: такая задача уезжает", () => {
  const plan = planCarry([item({ id: "a", status: "backlog" })]);
  assertEquals(kindOf(plan, "a"), "auto");
});

Deno.test("каждая строка состава получает ровно одно решение, порядок сохраняется", () => {
  const plan = planCarry([
    item({ id: "a", status: "done" }),
    item({ id: "b", to_carry: true }),
    item({ id: "c" }),
    item({ id: "d", removed_at: "2026-09-18T10:00:00Z" }),
  ]);
  assertEquals(plan.map((r) => r.id), ["a", "b", "c", "d"]);
  assertEquals(plan.map((r) => r.kind), ["stay", "manual", "auto", "mention"]);
});

Deno.test("пустой состав — пустой план, а не отказ", () => {
  assertEquals(planCarry([]), []);
});
