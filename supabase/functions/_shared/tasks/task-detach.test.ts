// Regression #1229: exercise the shared updateTask transaction payload with PostgREST fixtures.
import { assertEquals } from "@std/assert";

const saved = new Map(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [key, Deno.env.get(key)]));
Deno.env.set("SUPABASE_URL", "https://task-detach-fixture.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
const { updateTask } = await import("./db.ts");
for (const [key, value] of saved) {
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
}

const ID = "00000000-0000-0000-0000-000000001229";
const snapshot = (status: string, project_id: string | null = "fixture-project") => ({
  id: ID,
  status,
  project_id,
  group_id: "fixture-workspace",
  completed_at: null,
  recur_freq: null,
  recur_anchor_dom: null,
  recur_interval: null,
  recur_weekdays: null,
  recur_setpos: null,
  due_date: null,
  start_date: null,
  remind_date: null,
});
type Transaction = {
  p_patch: Record<string, unknown>;
  p_expect: Record<string, unknown>;
  p_history: Record<string, unknown>[];
};

async function transactions(
  rows: ReturnType<typeof snapshot>[],
  fields: Parameters<typeof updateTask>[1],
  conflictFirst = false,
): Promise<Transaction[]> {
  const original = globalThis.fetch;
  const calls: Transaction[] = [];
  let reads = 0;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/tasks")) {
      return Promise.resolve(Response.json([rows[Math.min(reads++, rows.length - 1)]]));
    }
    if (url.pathname.endsWith("/rpc/task_apply_update")) {
      calls.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        conflictFirst && calls.length === 1
          ? Response.json({ code: "PT409", message: "fixture concurrent update" }, { status: 409 })
          : Response.json(null),
      );
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  try {
    await updateTask(ID, fields, { actor: "fixture-actor", actorTelegramId: 1229 });
    return calls;
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("detach: project backlog becomes open and journals the ordinary status change", async () => {
  const [call] = await transactions([snapshot("backlog")], { project_id: null });
  assertEquals(call.p_patch.project_id, null);
  assertEquals(call.p_patch.status, "open");
  assertEquals(call.p_expect.status, "backlog");
  assertEquals(call.p_expect.project_id, "fixture-project");
  const status = call.p_history.find((row) => row.field === "status");
  assertEquals(status, {
    task_id: ID,
    field: "status",
    old_value: "backlog",
    new_value: "open",
    changed_by: "fixture-actor",
    changed_by_telegram_id: 1229,
    group_id: "fixture-workspace",
    old_status: "backlog",
    new_status: "open",
    note: null,
  });
  assertEquals(call.p_history.find((row) => row.field === "project")?.new_value, null);
});

Deno.test("detach: in-progress status is preserved without a status history entry", async () => {
  const [call] = await transactions([snapshot("in_progress")], { project_id: null });
  assertEquals(call.p_patch.status, undefined);
  assertEquals(call.p_history.some((row) => row.field === "status"), false);
});

Deno.test("detach: concurrent status change is reloaded instead of reset to open", async () => {
  const calls = await transactions([snapshot("backlog"), snapshot("in_progress")], { project_id: null }, true);
  assertEquals(calls.length, 2);
  assertEquals([calls[0].p_patch.status, calls[0].p_expect.status], ["open", "backlog"]);
  assertEquals(calls[1].p_patch.status, undefined);
  assertEquals(calls[1].p_history.some((row) => row.field === "status"), false);
});

Deno.test("detach: explicit in-progress transition keeps the requested status", async () => {
  const [call] = await transactions([snapshot("backlog")], { project_id: null, status: "in_progress" });
  assertEquals(call.p_patch.status, "in_progress");
});

Deno.test("detach: already unlinked backlog rows are not repaired by an unrelated update", async () => {
  const [call] = await transactions([snapshot("backlog", null)], { project_id: null });
  assertEquals(call.p_patch.status, undefined);
  assertEquals(call.p_history.length, 0);
});
