import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleModelUsageRoutes, MODEL_USAGE_PATH, type UsageScope } from "./model-usage.ts";

// Мини-база: model_usage с фильтром eq и диапазоном; meetings — пустая. Считает, какие group_id просили.
function makeUsageDb(
  rows: Array<Record<string, unknown>>,
  extra: Record<string, Array<Record<string, unknown>>> = {},
) {
  const askedGroups: unknown[] = [];
  const from = (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const b: Record<string, unknown> = {
      select: () => b,
      gte: () => b,
      lt: () => b,
      in: (c: string, v: unknown[]) => (ins.push([c, v]), b),
      is: (c: string, v: unknown) => (eqs.push([c, v]), b),
      order: () => b,
      eq: (c: string, v: unknown) => (eqs.push([c, v]), b),
      range: () => b,
      then: (res: (v: unknown) => unknown) => {
        if (table !== "model_usage") {
          const data = (extra[table] ?? []).filter((r) =>
            eqs.every(([c, v]) => (r[c] ?? null) === v) && ins.every(([c, vs]) => vs.includes(r[c]))
          );
          return Promise.resolve({ data, error: null }).then(res);
        }
        for (const [c, v] of eqs) if (c === "group_id") askedGroups.push(v);
        const data = rows.filter((r) => eqs.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data, error: null }).then(res);
      },
    };
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, askedGroups };
}

const row = (group_id: string | null, cost: number) => ({
  created_at: "2026-10-10T10:00:00Z",
  kind: "chat",
  model: "gpt-5.6-terra",
  purpose: "meeting:tezisy",
  meeting_id: null,
  prompt_tokens: 10,
  completion_tokens: 5,
  audio_seconds: null,
  cost_usd: cost,
  group_id,
});

const DATA = [row("cee", 1), row("cee", 2), row("demo", 10), row(null, 100)];
const URL_ = (extra = "") => `https://x${MODEL_USAGE_PATH}?from=2026-10-01&to=2026-10-31${extra}`;

async function get(scope: UsageScope, extra = "") {
  const db = makeUsageDb(DATA);
  const res = await handleModelUsageRoutes(new Request(URL_(extra)), MODEL_USAGE_PATH, db.client, scope, "*");
  return res!;
}

Deno.test("model-usage: не админ — 403, и без параметра, и с чужим пространством", async () => {
  for (const extra of ["", "&workspace=cee"]) {
    const res = await get({ isMaster: false, isAdmin: false, groupId: "cee", telegramId: 1 }, extra);
    assertEquals(res.status, 403);
    await res.body?.cancel();
  }
});

Deno.test("model-usage: админ пространства видит только своё; чужое пространство в параметре — 404", async () => {
  const own = await get({ isMaster: false, isAdmin: true, groupId: "cee", telegramId: 1 });
  assertEquals(own.status, 200);
  assertEquals((await own.json()).total_usd, 3); // только cee: 1 + 2; demo (10) и без пространства (100) не попали

  const other = await get({ isMaster: false, isAdmin: true, groupId: "cee", telegramId: 1 }, "&workspace=demo");
  assertEquals(other.status, 404);
  await other.body?.cancel();

  const same = await get({ isMaster: false, isAdmin: true, groupId: "cee", telegramId: 1 }, "&workspace=cee");
  assertEquals(same.status, 200);
  await same.body?.cancel();
});

Deno.test("model-usage: запрос админа всегда уходит в базу с фильтром по его пространству", async () => {
  const db = makeUsageDb(DATA);
  const res = await handleModelUsageRoutes(
    new Request(URL_()),
    MODEL_USAGE_PATH,
    db.client,
    { isMaster: false, isAdmin: true, groupId: "cee", telegramId: 1 },
    "*",
  );
  await res!.body?.cancel();
  assert(db.askedGroups.length > 0 && db.askedGroups.every((g) => g === "cee"));
});

Deno.test("model-usage: мастер-админ без параметра видит всё, с параметром — одно пространство", async () => {
  const all = await get({ isMaster: true, isAdmin: true, groupId: "cee", telegramId: 1 });
  assertEquals((await all.json()).total_usd, 113); // cee + demo + строка без пространства

  const demo = await get({ isMaster: true, isAdmin: true, groupId: "cee", telegramId: 1 }, "&workspace=demo");
  assertEquals(demo.status, 200);
  assertEquals((await demo.json()).total_usd, 10);
});

// Названия встреч: видит тот, кто видит запись (или записывал черновик); иначе null, расход остаётся.
const mrow = (meeting_id: string) => ({ ...row("cee", 1), meeting_id });
const MEETINGS = [
  { id: "m-open", title: "Общая", entry_id: "e-open", claim_owner: null, recorders: [] },
  { id: "m-priv", title: "Личная", entry_id: "e-priv", claim_owner: null, recorders: [] },
  { id: "m-gone", title: "Архивная", entry_id: "e-archived", claim_owner: null, recorders: [] },
  { id: "m-draft", title: "Черновик", entry_id: null, claim_owner: 7, recorders: [{ telegram_id: 8 }] },
];
const ENTRIES = [
  { id: "e-open", is_private: false, owner_id: 5, shared_with: [], archived_at: null },
  { id: "e-priv", is_private: true, owner_id: 5, shared_with: [6], archived_at: null },
  { id: "e-archived", is_private: false, owner_id: 5, shared_with: [], archived_at: "2026-01-01" },
];

async function titlesFor(viewer: number, isMaster = false) {
  const db = makeUsageDb(MEETINGS.map((m) => mrow(m.id)), { meetings: MEETINGS, entries: ENTRIES });
  const res = await handleModelUsageRoutes(
    new Request(URL_()),
    MODEL_USAGE_PATH,
    db.client,
    { isMaster, isAdmin: true, groupId: "cee", telegramId: viewer },
    "*",
  );
  const body = await res!.json();
  return { titles: body.meeting_titles as Record<string, string | null>, total: body.total_usd as number };
}

Deno.test("model-usage: название личной встречи — владельцу и тому, с кем разделена; админу и мастеру нет", async () => {
  assertEquals((await titlesFor(5)).titles["m-priv"], "Личная");
  assertEquals((await titlesFor(6)).titles["m-priv"], "Личная");
  const admin = await titlesFor(99);
  assertEquals(admin.titles["m-priv"], null);
  assertEquals(admin.titles["m-open"], "Общая");
  assertEquals((await titlesFor(99, true)).titles["m-priv"], null);
  assertEquals(admin.total, 4); // расход скрытых встреч в сумме остаётся
});

Deno.test("model-usage: название архивной встречи скрыто; черновик — только записывавшему и транскрибирующему", async () => {
  assertEquals((await titlesFor(5)).titles["m-gone"], null);
  assertEquals((await titlesFor(7)).titles["m-draft"], "Черновик");
  assertEquals((await titlesFor(8)).titles["m-draft"], "Черновик");
  assertEquals((await titlesFor(99)).titles["m-draft"], null);
});
