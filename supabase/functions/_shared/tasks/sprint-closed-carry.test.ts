// Regression #1159: run the real composition loader against PostgREST fixtures.
// No database, HTTP server or notifications: only the read projection is exercised.
import { assertEquals } from "@std/assert";

const saved = new Map(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [key, Deno.env.get(key)]));
Deno.env.set("SUPABASE_URL", "https://sprint-carry-fixture.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
const { listItems } = await import("./sprint-items.ts");
for (const [key, value] of saved) {
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
}

for (const frozen of [false, true]) {
  for (const status of ["open", "in_progress", "backlog", "done", "cancelled"]) {
    for (const marked of [true, false]) {
      Deno.test(`carry marker: ${frozen ? "snapshot" : "live"} ${status} marked=${marked}`, async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          const table = url.pathname.split("/").at(-1);
          const rows = table === "sprint_cycles" ? [{ id: "cycle" }] : table === "sprint_items"
            ? [{
              id: "item",
              task_id: "task",
              in_plan: true,
              added_at: "2026-11-01T00:00:00Z",
              frozen_at: frozen ? "2026-11-02T00:00:00Z" : null,
              frozen_status: frozen ? status : null,
              frozen_title: "Snapshot",
              to_carry: marked,
              carry_reason: "Finish next sprint",
              carry_count: 2,
            }]
            : table === "tasks"
            ? [{ id: "task", title: "Task", status, project_id: null }]
            : table === "task_comments"
            ? []
            : null;
          if (rows === null) throw new Error(`Unexpected PostgREST table: ${table}`);
          return Promise.resolve(
            new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } }),
          );
        };
        try {
          const items = await listItems("cycle", "workspace", "everyone");
          assertEquals(items.length, 1);
          const closed = status === "done" || status === "cancelled";
          assertEquals(items[0].status, status);
          assertEquals(items[0].to_carry, marked && !closed);
          assertEquals(items[0].carry_reason, marked && !closed ? "Finish next sprint" : null);
          assertEquals(items[0].carry_count, 2, "history remains visible");
        } finally {
          globalThis.fetch = original;
        }
      });
    }
  }
}
