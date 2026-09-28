import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decideFileAccess,
  getFileSecure,
  FileAccessError,
  type StorageFileRow,
  type FileRequester,
} from "./file-access.ts";

const entryFile: StorageFileRow = {
  path: "uploads/x.pdf",
  owner_kind: "entry",
  group_id: "cee",
  owner_user_id: 111,
  is_private: false,
};

const member: FileRequester = { groupId: "cee", telegramId: 222, isAdmin: false };

Deno.test("private entry attachment is invisible to a non-owner", () => {
  const row = { ...entryFile, is_private: true, owner_user_id: 111 };
  const decision = decideFileAccess(row, member); // requester 222 ≠ owner 111
  assertEquals(decision, { allowed: false, status: 404 });
});

Deno.test("owner sees their own private entry attachment", () => {
  const row = { ...entryFile, is_private: true, owner_user_id: 111 };
  const owner: FileRequester = { groupId: "cee", telegramId: 111, isAdmin: false };
  assertEquals(decideFileAccess(row, owner), { allowed: true });
});

Deno.test("public entry attachment in same workspace is visible", () => {
  assertEquals(decideFileAccess(entryFile, member), { allowed: true });
});

Deno.test("entry attachment from another workspace is denied even when public", () => {
  const row = { ...entryFile, group_id: "other", is_private: false };
  assertEquals(decideFileAccess(row, member), { allowed: false, status: 404 });
});

Deno.test("admin bypass does NOT apply to a private attachment (privacy rule)", () => {
  const row = { ...entryFile, is_private: true, owner_user_id: 111 };
  const admin: FileRequester = { groupId: "cee", telegramId: 999, isAdmin: true };
  assertEquals(decideFileAccess(row, admin), { allowed: false, status: 404 });
});

Deno.test("feedback screenshot is visible only to an admin", () => {
  const row: StorageFileRow = {
    path: "feedback/s.png",
    owner_kind: "feedback",
    group_id: "cee",
    owner_user_id: null,
    is_private: true,
  };
  const admin: FileRequester = { groupId: "cee", telegramId: 999, isAdmin: true };
  assertEquals(decideFileAccess(row, admin), { allowed: true });
});

Deno.test("feedback screenshot is denied to a non-admin", () => {
  const row: StorageFileRow = {
    path: "feedback/s.png",
    owner_kind: "feedback",
    group_id: "cee",
    owner_user_id: null,
    is_private: true,
  };
  assertEquals(decideFileAccess(row, member), { allowed: false, status: 404 });
});

// ── getFileSecure (реестр + свежие права записи) ────────────────────────────────

// Mock: from(table) отдаёт заранее заданные строки по таблице. maybeSingle возвращает
// текущую строку для этой таблицы (по последнему .from). Достаточно для одиночных резолвов.
function makeSupabase(rows: { storage_files?: unknown; entries?: unknown }): SupabaseClient {
  let current: unknown = null;
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: current });
  return {
    from: (table: string) => {
      current = (rows as Record<string, unknown>)[table] ?? null;
      return builder;
    },
  } as unknown as SupabaseClient;
}

Deno.test("getFileSecure: unknown path → 404", async () => {
  const sb = makeSupabase({ storage_files: null });
  await assertRejects(
    () => getFileSecure(sb, "nope.pdf", member),
    FileAccessError,
  );
});

Deno.test("getFileSecure: private entry attachment for non-owner → 404", async () => {
  const sb = makeSupabase({
    storage_files: { path: "uploads/x.pdf", bucket: "swarm_private", owner_kind: "entry", entry_id: "e1" },
    entries: { group_id: "cee", owner_id: 111, is_private: true },
  });
  await assertRejects(() => getFileSecure(sb, "uploads/x.pdf", member), FileAccessError);
});

Deno.test("getFileSecure: public entry attachment same workspace → resolves path+bucket", async () => {
  const sb = makeSupabase({
    storage_files: { path: "uploads/x.pdf", bucket: "swarm_private", owner_kind: "entry", entry_id: "e1" },
    entries: { group_id: "cee", owner_id: 111, is_private: false },
  });
  const res = await getFileSecure(sb, "uploads/x.pdf", member);
  assertEquals(res, { path: "uploads/x.pdf", bucket: "swarm_private" });
});

Deno.test("getFileSecure: feedback screenshot resolves for admin, 404 for member", async () => {
  const reg = { path: "feedback/s.png", bucket: "swarm_private", owner_kind: "feedback", entry_id: null };
  const admin: FileRequester = { groupId: "cee", telegramId: 999, isAdmin: true };
  assertEquals(
    await getFileSecure(makeSupabase({ storage_files: reg }), "feedback/s.png", admin),
    { path: "feedback/s.png", bucket: "swarm_private" },
  );
  await assertRejects(
    () => getFileSecure(makeSupabase({ storage_files: reg }), "feedback/s.png", member),
    FileAccessError,
  );
});
