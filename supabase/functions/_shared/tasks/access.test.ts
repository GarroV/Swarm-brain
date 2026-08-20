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
  assertEquals(canViewTask(privateTask, OWNER, false), true);
  assertEquals(canMutateTask(privateTask, OWNER, false), true);
});

Deno.test("ЧУЖУЮ личную задачу участник того же воркспейса не видит и не меняет", () => {
  assertEquals(canViewTask(privateTask, OTHER, false), false);
  assertEquals(canMutateTask(privateTask, OTHER, false), false);
});

Deno.test("админ имеет оверсайт по задачам (в отличие от записей/встреч)", () => {
  assertEquals(canViewTask(privateTask, ADMIN, true), true);
  assertEquals(canMutateTask(privateTask, ADMIN, true), true);
});

Deno.test("командную задачу видит и меняет любой в воркспейсе", () => {
  assertEquals(canViewTask(teamTask, OTHER, false), true);
  assertEquals(canMutateTask(teamTask, OTHER, false), true);
});

Deno.test("owner_id пуст у приватной задачи — доступ только админу (fail-closed)", () => {
  const orphan = { is_private: true, owner_id: null, group_id: "cee" };
  assertEquals(canViewTask(orphan, OTHER, false), false);
  assertEquals(canViewTask(orphan, ADMIN, true), true);
});

// ── Отказ неотличим от «нет записи» ───────────────────────────────────────────
// Иначе перебором id выясняется, что у коллеги есть личная задача, — сам факт уже утечка.

Deno.test("отказ по чужой личной задаче звучит как «не найдена», без деталей", () => {
  const denied = taskAccessError("t-1", privateTask, OTHER, false);
  const missing = taskAccessError("t-1", null, OTHER, false);
  assertEquals(denied, missing);
  assertEquals(denied, "Задача t-1 не найдена.");
});

Deno.test("чужой ВОРКСПЕЙС тоже даёт неотличимый отказ", () => {
  const foreign = { is_private: false, owner_id: null, group_id: "other" };
  const denied = taskAccessError("t-2", foreign, OTHER, false, "cee");
  assertEquals(denied, "Задача t-2 не найдена.");
});

Deno.test("доступной задаче taskAccessError возвращает null (пропуск)", () => {
  assertEquals(taskAccessError("t-3", teamTask, OTHER, false, "cee"), null);
  assertEquals(taskAccessError("t-4", privateTask, OWNER, false, "cee"), null);
});
