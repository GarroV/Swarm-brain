import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CLIENT_SEEN_MIN_INTERVAL_MS, markClientSeen } from "./client-seen.ts";

// Фейк цепочки update().eq().or(): запоминает, что и с какими условиями записали.
function fakeSupabase(result: { error: { message: string } | null } | "throw") {
  const calls: { table: string; patch: unknown; eq: [string, unknown]; or: string }[] = [];
  const client = {
    from(table: string) {
      return {
        update(patch: unknown) {
          return {
            eq(col: string, val: unknown) {
              return {
                or(filter: string) {
                  calls.push({ table, patch, eq: [col, val], or: filter });
                  if (result === "throw") return Promise.reject(new Error("сеть упала"));
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, calls };
}

const NOW = new Date("2026-10-13T12:00:00Z");

Deno.test("пишет нужную колонку и пропускает свежие отметки (порог 10 минут)", async () => {
  const { client, calls } = fakeSupabase({ error: null });
  await markClientSeen(client, 42, "recorder", NOW);
  const threshold = new Date(NOW.getTime() - CLIENT_SEEN_MIN_INTERVAL_MS).toISOString();
  assertEquals(calls, [{
    table: "allowed_users",
    patch: { recorder_last_seen_at: NOW.toISOString() },
    eq: ["telegram_id", 42],
    or: `recorder_last_seen_at.is.null,recorder_last_seen_at.lt.${threshold}`,
  }]);
});

Deno.test("MCP пишет в свою колонку", async () => {
  const { client, calls } = fakeSupabase({ error: null });
  await markClientSeen(client, 7, "mcp", NOW);
  assertEquals(calls[0].patch, { mcp_last_seen_at: NOW.toISOString() });
});

Deno.test("ошибка записи и исключение не пробрасываются", async () => {
  await markClientSeen(fakeSupabase({ error: { message: "boom" } }).client, 1, "mcp", NOW);
  await markClientSeen(fakeSupabase("throw").client, 1, "mcp", NOW);
});
