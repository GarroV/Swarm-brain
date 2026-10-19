import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleModelUsageRoutes, MODEL_USAGE_PATH, type UsageScope } from "./model-usage.ts";

// Мини-база: model_usage с фильтром eq и диапазоном; meetings — пустая. Считает, какие group_id просили.
function makeUsageDb(rows: Array<Record<string, unknown>>) {
  const askedGroups: unknown[] = [];
  const from = (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {
      select: () => b,
      gte: () => b,
      lt: () => b,
      in: () => b,
      order: () => b,
      eq: (c: string, v: unknown) => (eqs.push([c, v]), b),
      range: () => b,
      then: (res: (v: unknown) => unknown) => {
        if (table !== "model_usage") return Promise.resolve({ data: [], error: null }).then(res);
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
    const res = await get({ isMaster: false, isAdmin: false, groupId: "cee" }, extra);
    assertEquals(res.status, 403);
    await res.body?.cancel();
  }
});

Deno.test("model-usage: админ пространства видит только своё; чужое пространство в параметре — 404", async () => {
  const own = await get({ isMaster: false, isAdmin: true, groupId: "cee" });
  assertEquals(own.status, 200);
  assertEquals((await own.json()).total_usd, 3); // только cee: 1 + 2; demo (10) и без пространства (100) не попали

  const other = await get({ isMaster: false, isAdmin: true, groupId: "cee" }, "&workspace=demo");
  assertEquals(other.status, 404);
  await other.body?.cancel();

  const same = await get({ isMaster: false, isAdmin: true, groupId: "cee" }, "&workspace=cee");
  assertEquals(same.status, 200);
  await same.body?.cancel();
});

Deno.test("model-usage: запрос админа всегда уходит в базу с фильтром по его пространству", async () => {
  const db = makeUsageDb(DATA);
  const res = await handleModelUsageRoutes(
    new Request(URL_()),
    MODEL_USAGE_PATH,
    db.client,
    { isMaster: false, isAdmin: true, groupId: "cee" },
    "*",
  );
  await res!.body?.cancel();
  assert(db.askedGroups.length > 0 && db.askedGroups.every((g) => g === "cee"));
});

Deno.test("model-usage: мастер-админ без параметра видит всё, с параметром — одно пространство", async () => {
  const all = await get({ isMaster: true, isAdmin: true, groupId: "cee" });
  assertEquals((await all.json()).total_usd, 113); // cee + demo + строка без пространства

  const demo = await get({ isMaster: true, isAdmin: true, groupId: "cee" }, "&workspace=demo");
  assertEquals(demo.status, 200);
  assertEquals((await demo.json()).total_usd, 10);
});
