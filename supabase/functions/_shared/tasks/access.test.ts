import { assertEquals } from "jsr:@std/assert@1";
import { canMutateTask, canViewTask, taskAccessError } from "./access.ts";

// Правило приватности задач жило шестью рукописными копиями и разошлось: swarm-mcp правил и
// удалял чужие личные задачи (issue #45). Здесь — единственный источник правды, и тесты
// написаны в форме, где «чужое» РЕАЛЬНО существует в данных, а не отсутствует.

const OWNER = 111;
const OTHER = 222;
const ADMIN = 744230399;

const privateTask = { is_private: true, owner_id: OWNER, group_id: "cee" };
const teamTask = { is_private: false, owner_id: null, group_id: "cee" };

Deno.test("владелец видит и меняет свою личную задачу", () => {
  assertEquals(canViewTask(privateTask, OWNER), true);
  assertEquals(canMutateTask(privateTask, OWNER), true);
});

Deno.test("ЧУЖУЮ личную задачу участник того же воркспейса не видит и не меняет", () => {
  assertEquals(canViewTask(privateTask, OTHER), false);
  assertEquals(canMutateTask(privateTask, OTHER), false);
});

Deno.test("админ НЕ видит и НЕ правит чужую личную задачу (обход снят 2026-08-21)", () => {
  assertEquals(canViewTask(privateTask, ADMIN), false);
  assertEquals(canMutateTask(privateTask, ADMIN), false);
});

Deno.test("командную задачу видит и меняет любой в воркспейсе", () => {
  assertEquals(canViewTask(teamTask, OTHER), true);
  assertEquals(canMutateTask(teamTask, OTHER), true);
});

Deno.test("owner_id пуст у приватной задачи — доступа нет ни у кого (fail-closed)", () => {
  const orphan = { is_private: true, owner_id: null, group_id: "cee" };
  assertEquals(canViewTask(orphan, OTHER), false);
  assertEquals(canViewTask(orphan, ADMIN), false);
});

// ── Отказ неотличим от «нет записи» ───────────────────────────────────────────
// Иначе перебором id выясняется, что у коллеги есть личная задача, — сам факт уже утечка.

Deno.test("отказ по чужой личной задаче звучит как «не найдена», без деталей", () => {
  const denied = taskAccessError("t-1", privateTask, OTHER);
  const missing = taskAccessError("t-1", null, OTHER);
  assertEquals(denied, missing);
  assertEquals(denied, "Задача t-1 не найдена.");
});

Deno.test("чужой ВОРКСПЕЙС тоже даёт неотличимый отказ", () => {
  const foreign = { is_private: false, owner_id: null, group_id: "other" };
  const denied = taskAccessError("t-2", foreign, OTHER, "cee");
  assertEquals(denied, "Задача t-2 не найдена.");
});

Deno.test("доступной задаче taskAccessError возвращает null (пропуск)", () => {
  assertEquals(taskAccessError("t-3", teamTask, OTHER, "cee"), null);
  assertEquals(taskAccessError("t-4", privateTask, OWNER, "cee"), null);
});
