import { assertEquals } from "jsr:@std/assert@1";
import { canAccessTask, taskAccessError } from "./access.ts";

// Правило доступа к задаче — один воркспейс (решение 2026-10-09: «личных» задач нет). Тесты
// написаны в форме, где «чужое» РЕАЛЬНО существует в данных, а не отсутствует.

const task = { group_id: "cee" };
const foreign = { group_id: "other" };

Deno.test("задачу своего воркспейса видит и меняет любой участник", () => {
  assertEquals(canAccessTask(task, "cee"), true);
  assertEquals(taskAccessError("t-1", task, "cee"), null);
});

Deno.test("задача чужого воркспейса недоступна", () => {
  assertEquals(canAccessTask(foreign, "cee"), false);
});

Deno.test("без воркспейса зрителя доступа нет (fail-closed)", () => {
  assertEquals(canAccessTask(task, null), false);
  assertEquals(canAccessTask({ group_id: null }, null), false);
});

// Отказ неотличим от «нет записи»: перебор id не выдаёт задачи чужого воркспейса.
Deno.test("чужой воркспейс даёт отказ, неотличимый от «не найдена»", () => {
  const denied = taskAccessError("t-2", foreign, "cee");
  const missing = taskAccessError("t-2", null, "cee");
  assertEquals(denied, missing);
  assertEquals(denied, "Задача t-2 не найдена.");
});
