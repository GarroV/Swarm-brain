import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEntriesQuery,
  EntryAccessError,
  getEntrySecure,
} from "./entries-guard.ts";

// ── Mock chainable query builder ───────────────────────────────────────────────

type Call = { method: string; args: unknown[] };

function makeSupabase(singleData: unknown): {
  client: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve({ data: singleData });
  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const baseEntry = {
  id: "e1",
  group_id: "cee",
  is_private: false,
  owner_id: 111,
  content: "x",
};

// ── getEntrySecure ──────────────────────────────────────────────────────────────

Deno.test("getEntrySecure — returns entry when workspace + visibility pass", async () => {
  const { client } = makeSupabase(baseEntry);
  const row = await getEntrySecure(client, "e1", { groupId: "cee", telegramId: 999 });
  assertEquals(row.id, "e1");
});

Deno.test("getEntrySecure — 404 when entry missing", async () => {
  const { client } = makeSupabase(null);
  await assertRejects(
    () => getEntrySecure(client, "e1", { groupId: "cee", telegramId: 999 }),
    EntryAccessError,
    "Not found",
  );
});

Deno.test("getEntrySecure — 404 on cross-workspace access (isolation)", async () => {
  const { client } = makeSupabase({ ...baseEntry, group_id: "other" });
  const err = await assertRejects(
    () => getEntrySecure(client, "e1", { groupId: "cee", telegramId: 999 }),
    EntryAccessError,
  );
  assertEquals((err as EntryAccessError).status, 404);
});

Deno.test("getEntrySecure — private entry is 404 (not 403) for non-owner", async () => {
  const { client } = makeSupabase({ ...baseEntry, is_private: true, owner_id: 111 });
  const err = await assertRejects(
    () => getEntrySecure(client, "e1", { groupId: "cee", telegramId: 222 }),
    EntryAccessError,
  );
  // Must be indistinguishable from "missing" — leaking existence is a privacy bug
  assertEquals((err as EntryAccessError).status, 404);
});

Deno.test("getEntrySecure — owner can read own private entry", async () => {
  const { client } = makeSupabase({ ...baseEntry, is_private: true, owner_id: 111 });
  const row = await getEntrySecure(client, "e1", { groupId: "cee", telegramId: 111 });
  assertEquals(row.owner_id, 111);
});

Deno.test("getEntrySecure — requireOwner: 403 for non-owner mutation", async () => {
  const { client } = makeSupabase({ ...baseEntry, owner_id: 111 });
  const err = await assertRejects(
    () =>
      getEntrySecure(client, "e1", {
        groupId: "cee",
        telegramId: 222,
        requireOwner: true,
      }),
    EntryAccessError,
  );
  assertEquals((err as EntryAccessError).status, 403);
});

Deno.test("getEntrySecure — requireOwner: owner passes", async () => {
  const { client } = makeSupabase({ ...baseEntry, owner_id: 111 });
  const row = await getEntrySecure(client, "e1", {
    groupId: "cee",
    telegramId: 111,
    requireOwner: true,
  });
  assertEquals(row.id, "e1");
});

// ── buildEntriesQuery ───────────────────────────────────────────────────────────

Deno.test("buildEntriesQuery — applies group isolation + visibility filter", () => {
  const { client, calls } = makeSupabase(null);
  buildEntriesQuery(client, "id, content", { groupId: "cee", telegramId: 111 });

  const eq = calls.find((c) => c.method === "eq");
  assertEquals(eq?.args, ["group_id", "cee"]);

  const or = calls.find((c) => c.method === "or");
  assertEquals(
    or?.args[0],
    "is_private.eq.false,and(is_private.eq.true,owner_id.eq.111)",
  );
});
