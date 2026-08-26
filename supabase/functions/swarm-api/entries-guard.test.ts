import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEntriesQuery,
  buildReviewQueueQuery,
  EntryAccessError,
  getEntrySecure,
  ENTRY_COLUMNS,
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

// ── ENTRY_COLUMNS ─────────────────────────────────────────────────────────────

const cols = () => ENTRY_COLUMNS.split(",").map((c) => c.trim());

Deno.test("ENTRY_COLUMNS не тянет колонки, которых нет в EntryRow — сервер их не читает, фронт не знает", () => {
  for (const dead of ["embedding", "fts", "last_review_reminded_at", "*"]) {
    assertEquals(cols().includes(dead), false, `${dead} не должна уезжать в браузер`);
  }
});

Deno.test("ENTRY_COLUMNS покрывает все поля EntryRow + updated_at", () => {
  const need = [
    "id", "content", "summary", "added_by", "source", "metadata", "countries",
    "entry_type", "entry_date", "group_id", "is_private", "owner_id", "created_at", "updated_at",
  ];
  for (const f of need) assertEquals(cols().includes(f), true, `${f} есть в EntryRow, но не запрашивается`);
});

Deno.test("getEntrySecure запрашивает ENTRY_COLUMNS, а не '*'", async () => {
  const { client, calls } = makeSupabase(baseEntry);
  await getEntrySecure(client, "e1", { groupId: "cee", telegramId: 999 });
  const select = calls.find((c) => c.method === "select");
  assertEquals(select?.args[0], ENTRY_COLUMNS);
});

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

// ── Очередь вычитки: несогласованную встречу видят только причастные ──────────
// Решение владельца 2026-08-22: «не должно быть ничьих — вся информация принадлежит кому-то;
// если встреча была общая, показывать на вычитке всем участникам, сохранит тот, кто успеет».
// До этого несогласованная общая встреча (is_private=false, owner_id=NULL — так их создаёт
// read-ai-webhook) проходила обычный фильтр видимости и висела в очереди у ВСЕГО воркспейса:
// её мог согласовать или удалить человек, которого на встрече не было (issue #66).

Deno.test("buildReviewQueueQuery — фильтр по причастности, а не по is_private", () => {
  const { client, calls } = makeSupabase(null);
  buildReviewQueueQuery(client, "*", { groupId: "cee", telegramId: 111, email: "me@dodo.io" });

  const or = calls.find((c) => c.method === "or");
  const cond = String(or?.args[0] ?? "");
  // владелец записи ИЛИ участник встречи (по email в metadata.attendees)
  assertEquals(cond.includes("owner_id.eq.111"), true);
  assertEquals(cond.includes("me@dodo.io"), true);
  // «видна всем, раз не приватная» здесь НЕ действует — иначе вернётся прежний баг
  assertEquals(cond.includes("is_private.eq.false"), false);
});

Deno.test("buildReviewQueueQuery — без email фильтруем только по владельцу (fail-closed)", () => {
  const { client, calls } = makeSupabase(null);
  buildReviewQueueQuery(client, "*", { groupId: "cee", telegramId: 111, email: null });
  const cond = String(calls.find((c) => c.method === "or")?.args[0] ?? "");
  assertEquals(cond.includes("owner_id.eq.111"), true);
  assertEquals(cond.includes("attendees"), false);
});
