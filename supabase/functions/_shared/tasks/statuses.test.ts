// Набор статусов задачи — один на код, базу и инструменты MCP (issue #208).
//
// Почему тест сверяет списки, а не просто вызывает функцию: набор продублирован в трёх местах
// по необходимости — в TypeScript-константе, в CHECK-ограничении базы и в JSON-схемах MCP,
// где enum обязан быть литералом. Дубли расходятся молча: разъехавшийся enum просто перестанет
// принимать статус, а разъехавшийся CHECK начнёт отбивать вставки на проде.
import { assertEquals } from "jsr:@std/assert@1";
import { isTaskStatus, TASK_STATUSES, taskStatusError } from "./statuses.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

Deno.test("известные статусы принимаются, чужие — нет", () => {
  for (const s of TASK_STATUSES) assertEquals(isTaskStatus(s), true, s);
  for (const s of ["pending", "PENDING", "", "open ", "todo", null, 7, undefined]) {
    assertEquals(isTaskStatus(s), false, String(s));
  }
});

Deno.test("pending отдельно: именно он прятал задачи, и он больше не статус", () => {
  assertEquals(isTaskStatus("pending"), false);
  assertEquals(taskStatusError("pending").includes("pending"), true);
  assertEquals(taskStatusError("pending").includes("open, in_progress, done, cancelled, backlog"), true);
});

Deno.test("CHECK в базе перечисляет ровно тот же набор", async () => {
  const sql = await Deno.readTextFile(`${ROOT}../migrations/20260905190000_tasks_status_check.sql`);
  const m = sql.match(/status in \(([^)]+)\)/);
  assertEquals(m !== null, true, "не нашёл список статусов в миграции");
  const вБазе = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort();
  assertEquals(вБазе, [...TASK_STATUSES].sort());
});

Deno.test("enum'ы MCP перечисляют ровно тот же набор", async () => {
  const src = await Deno.readTextFile(`${ROOT}swarm-mcp/tasks/tools.ts`);
  const enums = [...src.matchAll(/enum:\s*\[([^\]]*"done"[^\]]*)\]/g)];
  assertEquals(enums.length > 0, true, "не нашёл ни одного enum статусов в tools.ts");
  for (const e of enums) {
    const список = e[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean).sort();
    assertEquals(список, [...TASK_STATUSES].sort());
  }
});
