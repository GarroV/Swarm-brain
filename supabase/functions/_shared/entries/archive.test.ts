// Архивация записи (#569) и её задач (#687): запись не стирается, задачи встречи — тоже.
import { assert, assertEquals } from "@std/assert";
import { archiveEntry, meetingTaskKeys } from "./archive.ts";

type Call = { table: string; op: string; args: unknown[] };

/** Построитель-самописец: пишет каждый вызов цепочки, в конце отдаёт заданный ответ. */
function fakeSupabase(results: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const res = results[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const op of ["update", "eq", "in", "is", "select", "delete"]) {
        chain[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return chain;
        };
      }
      chain.then = (ok: (v: unknown) => unknown) => ok({ data: res.data ?? null, error: res.error ?? null });
      return chain;
    },
  };
  return { client, calls };
}

const ops = (calls: Call[], table: string) => calls.filter((c) => c.table === table).map((c) => c.op);

Deno.test("meetingTaskKeys: id записи и id исходной встречи, без пустых и дублей", () => {
  assertEquals(meetingTaskKeys({ id: "e1", metadata: { meeting_id: "m1" } }), ["e1", "m1"]);
  assertEquals(meetingTaskKeys({ id: "e1", metadata: { meeting_id: "e1" } }), ["e1"]);
  assertEquals(meetingTaskKeys({ id: "e1", metadata: { meeting_id: "" } }), ["e1"]);
  assertEquals(meetingTaskKeys({ id: "e1", metadata: { meeting_id: 42 } }), ["e1"]);
  assertEquals(meetingTaskKeys({ id: "e1", metadata: null }), ["e1"]);
});

Deno.test("archiveEntry ставит archived_at/archived_by и НИЧЕГО не удаляет", async () => {
  const { client, calls } = fakeSupabase({ tasks: { data: [{ id: "t1" }, { id: "t2" }] } });
  const res = await archiveEntry(client as never, { id: "e1", metadata: { meeting_id: "m1" } }, 777);

  assertEquals(res, { error: null, archivedTasks: 2 });
  assert(!calls.some((c) => c.op === "delete"), "физического удаления быть не должно");

  const entryUpdate = calls.find((c) => c.table === "entries" && c.op === "update");
  const patch = entryUpdate?.args[0] as { archived_at: string; archived_by: number };
  assertEquals(patch.archived_by, 777);
  assert(!Number.isNaN(Date.parse(patch.archived_at)), "archived_at — момент времени");
  assertEquals(ops(calls, "entries"), ["update", "eq", "is"]);
  assert(calls.some((c) => c.table === "entries" && c.op === "is" && c.args[0] === "archived_at"));
});

Deno.test("archiveEntry архивирует задачи встречи по обоим ключам, только живые", async () => {
  const { client, calls } = fakeSupabase({ tasks: { data: [] } });
  await archiveEntry(client as never, { id: "e1", metadata: { meeting_id: "m1" } }, 777);

  const taskCalls = calls.filter((c) => c.table === "tasks");
  assertEquals(taskCalls[0].op, "update");
  assertEquals((taskCalls[0].args[0] as { archived_by: number }).archived_by, 777);
  assertEquals(taskCalls.find((c) => c.op === "in")?.args, ["meeting_id", ["e1", "m1"]]);
  assert(taskCalls.some((c) => c.op === "is" && c.args[0] === "archived_at" && c.args[1] === null));
});

Deno.test("archiveEntry: ошибка записи — задачи не трогаем и говорим об ошибке", async () => {
  const { client, calls } = fakeSupabase({ entries: { error: { message: "boom" } } });
  const res = await archiveEntry(client as never, { id: "e1", metadata: null }, 1);
  assertEquals(res, { error: "boom", archivedTasks: 0 });
  assertEquals(ops(calls, "tasks"), []);
});

Deno.test("archiveEntry: ошибка задач не глушится", async () => {
  const { client } = fakeSupabase({ tasks: { error: { message: "tasks down" } } });
  const res = await archiveEntry(client as never, { id: "e1", metadata: null }, 1);
  assertEquals(res.error, "tasks down");
});
