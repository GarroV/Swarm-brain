import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearDraftPrimaryPrefix, deleteDraftMeeting, type DraftDeleteCaller } from "./meeting-delete.ts";

const ID = "a0000000-0000-4000-8000-000000001168";
const OTHER = "00000000-0000-4000-8000-000000001169";
const caller: DraftDeleteCaller = { telegramId: 1168, groupId: "fixture-home", isAdmin: false };
function fixture() {
  let row: Record<string, unknown> | null = {
    id: ID,
    version: "10:(0,1)",
    group_id: caller.groupId,
    status: "awaiting_review",
    entry_id: null,
    recorders: [{ telegram_id: 1168 }],
    co_owners: [],
  };
  let job: Record<string, unknown> | null = null;
  const objects = new Set([
    `${ID}/generation/system.m4a`,
    `${ID}/queued/source.json`,
    `${OTHER}/audio.m4a`,
    "backup/safe.m4a",
  ]);
  const effects: string[] = [];
  let failRemove = false, partialRemove = false, failList = false, failComplete = false, mutateOnCAS = false;
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      effects.push(name);
      if (name === "draft_meeting_delete_snapshot") {
        return Promise.resolve({ data: row ? structuredClone(row) : null, error: null });
      }
      if (name !== "start_draft_meeting_delete") throw new Error("unexpected_rpc");
      if (mutateOnCAS && row) {
        row.status = "in_base";
        row.version = "11:(0,2)";
      }
      if (!row || row.version !== args.p_version || row.group_id !== args.p_group_id || row.status === "in_base") {
        return Promise.resolve({ data: false, error: null });
      }
      job = {
        meeting_id: ID,
        group_id: row.group_id,
        requested_by: args.p_actor,
        requested_group_id: args.p_actor_group,
        completed_at: null,
      };
      row = null;
      return Promise.resolve({ data: true, error: null });
    },
    from: (table: string) => {
      if (table !== "draft_meeting_deletions") throw new Error("unexpected_table");
      let update: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: job, error: null }),
        update: (data: Record<string, unknown>) => {
          update = data;
          return builder;
        },
        is: () => {
          effects.push("complete");
          if (!failComplete && job) Object.assign(job, update);
          return Promise.resolve({ error: failComplete ? { code: "fixture" } : null });
        },
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => {
        assertEquals(bucket, "meeting-audio");
        return {
          list: (prefix: string, options: { limit: number; offset: number }) => {
            effects.push("list");
            if (failList) return Promise.resolve({ data: null, error: { code: "fixture" } });
            const entries = new Map<string, { name: string; id: string | null }>();
            for (const path of objects) {
              if (!path.startsWith(prefix + "/")) continue;
              const rest = path.slice(prefix.length + 1), name = rest.split("/")[0];
              entries.set(name, { name, id: rest.includes("/") ? null : "object" });
            }
            return Promise.resolve({
              data: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(
                options.offset,
                options.offset + options.limit,
              ),
              error: null,
            });
          },
          remove: (paths: string[]) => {
            effects.push("remove");
            if (failRemove) return Promise.resolve({ error: { code: "fixture" } });
            paths.slice(0, partialRemove ? 1 : paths.length).forEach((p) => objects.delete(p));
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
  };
  return {
    sb: db as unknown as SupabaseClient,
    objects,
    effects,
    get row() {
      return row;
    },
    get job() {
      return job;
    },
    setRow(value: Record<string, unknown>) {
      row = { ...row, ...value };
    },
    failRemove(value: boolean) {
      failRemove = value;
    },
    partialRemove(value: boolean) {
      partialRemove = value;
    },
    failList() {
      failList = true;
    },
    failComplete(value: boolean) {
      failComplete = value;
    },
    mutateOnCAS() {
      mutateOnCAS = true;
    },
  };
}

Deno.test("draft deletion: exact primary prefix, queued metadata, backup preservation and idempotent repeat", async () => {
  const f = fixture();
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: true });
  assertEquals(f.row, null);
  assertEquals([...f.objects], [`${OTHER}/audio.m4a`, "backup/safe.m4a"]);
  assertEquals(f.effects.indexOf("start_draft_meeting_delete") < f.effects.indexOf("remove"), true);
  const removals = f.effects.filter((x) => x === "remove").length;
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: true });
  assertEquals(f.effects.filter((x) => x === "remove").length, removals);
});

for (const failure of ["storage_error", "partial_success", "completion_error"] as const) {
  Deno.test(`draft deletion: ${failure} stays pending and a confirmed retry completes`, async () => {
    const f = fixture();
    if (failure === "storage_error") f.failRemove(true);
    if (failure === "partial_success") f.partialRemove(true);
    if (failure === "completion_error") f.failComplete(true);
    assertEquals(await deleteDraftMeeting(f.sb, ID, caller), {
      ok: false,
      reason: failure === "completion_error" ? "database" : "storage",
    });
    assertEquals(f.row, null);
    assertEquals(f.job?.completed_at, null);
    f.failRemove(false);
    f.partialRemove(false);
    f.failComplete(false);
    assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: true });
    assertEquals([...f.objects], [`${OTHER}/audio.m4a`, "backup/safe.m4a"]);
  });
}

Deno.test("draft deletion: changed-after-check returns conflict without Storage effects", async () => {
  const f = fixture();
  f.mutateOnCAS();
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: false, reason: "changed" });
  assertEquals(f.row?.status, "in_base");
  assertEquals(f.job, null);
  assertEquals(f.effects.includes("list"), false);
  assertEquals(f.objects.size, 4);
});

for (
  const [change, actor, reason] of [
    [{ status: "in_base" }, caller, "published"],
    [{ recorders: [{ telegram_id: 999 }] }, caller, "not_found"],
    [{ co_owners: [999] }, caller, "shared"],
    [{ recorders: [], claim_owner: 1168 }, caller, "forbidden"],
    [{ group_id: "other" }, { ...caller, isAdmin: true }, "not_found"],
  ] as const
) {
  Deno.test(`draft deletion: existing guard ${reason} does not mutate`, async () => {
    const f = fixture();
    f.setRow(change);
    assertEquals(await deleteDraftMeeting(f.sb, ID, actor), { ok: false, reason });
    assertEquals(f.job, null);
    assertEquals(f.effects.includes("remove"), false);
  });
}

Deno.test("draft deletion: current same-workspace admin can delete another draft", async () => {
  const f = fixture();
  f.setRow({ recorders: [{ telegram_id: 999 }], co_owners: [998] });
  assertEquals(await deleteDraftMeeting(f.sb, ID, { ...caller, isAdmin: true }), { ok: true });
});

Deno.test("draft deletion: pending retries require original current scope or current home admin", async () => {
  const f = fixture();
  f.failRemove(true);
  await deleteDraftMeeting(f.sb, ID, caller);
  f.failRemove(false);
  const calls = f.effects.length;
  assertEquals(await deleteDraftMeeting(f.sb, ID, { ...caller, groupId: "moved" }), { ok: false, reason: "not_found" });
  assertEquals(await deleteDraftMeeting(f.sb, ID, { ...caller, telegramId: 999 }), { ok: false, reason: "not_found" });
  assertEquals(f.effects.slice(calls).includes("remove"), false);
  assertEquals(await deleteDraftMeeting(f.sb, ID, { ...caller, telegramId: 999, isAdmin: true }), { ok: true });
});

Deno.test("draft deletion: listing errors and invalid identifiers cannot report cleanup success", async () => {
  const f = fixture();
  f.failList();
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: false, reason: "storage" });
  assertEquals(f.job?.completed_at, null);
  assertEquals(await clearDraftPrimaryPrefix(f.sb, "../backup"), false);
});

Deno.test("draft deletion: paginated cleanup preserves foreign prefix and makes bounded progress", async () => {
  const f = fixture();
  for (let i = 0; i < 110; i++) f.objects.add(`${ID}/folder-${String(i).padStart(3, "0")}/audio.m4a`);
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: false, reason: "storage" });
  assertEquals(f.objects.size < 114, true);
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: true });
  assertEquals([...f.objects], [`${OTHER}/audio.m4a`, "backup/safe.m4a"]);
});

Deno.test("draft deletion: repeated completion checks any late primary object without touching backup", async () => {
  const f = fixture();
  assertEquals(await deleteDraftMeeting(f.sb, ID, caller), { ok: true });
  const completed = f.job?.completed_at;
  f.objects.add(`${ID}/generation/late.bin`);
  assertEquals(await deleteDraftMeeting(f.sb, ID.toUpperCase(), caller), { ok: true });
  assertEquals(f.objects.has(`${ID}/generation/late.bin`), false);
  assertEquals(f.objects.has("backup/safe.m4a"), true);
  assertEquals(f.job?.completed_at, completed);
});
