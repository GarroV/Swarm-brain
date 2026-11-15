import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client, PostgresError } from "postgres";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordModelUsage } from "./model-usage.ts";
import { summarizeUsage, type UsageRow } from "./model-usage-summary.ts";
import { recordedUsageUnits, type StoredUsageCost, USAGE_COST_COLUMNS } from "./model-usage-cost.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const AT = "2026-11-14T10:00:00Z";
const migration = await Deno.readTextFile(
  new URL("../../migrations/20261114235500_model_usage_cost_precision.sql", import.meta.url),
);

async function fixture(run: (db: Client, purpose: string) => Promise<void>) {
  assertEquals(Deno.env.get("GITHUB_ACTIONS"), "true", "isolated GitHub CI fixture required");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(DB_URL).hostname), "isolated loopback database required");
  assertEquals(new URL(DB_URL).pathname, "/postgres", "known synthetic Supabase database required");
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await db.queryArray("begin");
    await db.queryArray("set local statement_timeout = '10s'");
    await db.queryArray("set local lock_timeout = '2s'");
    await run(db, `precision752:${crypto.randomUUID()}`);
  } finally {
    try {
      await db.queryArray("rollback");
    } finally {
      await db.end();
    }
  }
}

async function produce(db: Client, purpose: string, tokens: number, model = "text-embedding-3-small") {
  await recordModelUsage(
    "https://api.openai.com/v1/embeddings",
    { body: JSON.stringify({ model }) },
    new Response(JSON.stringify({ model, usage: { prompt_tokens: tokens } })),
    { purpose },
    async (actual) => {
      // This is the real producer's row, not a second implementation of its price formula.
      await db.queryArray`
        insert into public.model_usage(created_at, kind, model, purpose, prompt_tokens, cost_usd, cost_usd_precise)
        values (${AT}, ${actual.kind}, ${actual.model}, ${actual.purpose}, ${actual.prompt_tokens},
                ${actual.cost_usd}, ${actual.cost_usd_precise})`;
      return { error: null };
    },
  );
}

async function rows(db: Client, purpose: string): Promise<UsageRow[]> {
  return (await db.queryObject<UsageRow>`
    select created_at::text, kind, model, purpose, meeting_id, prompt_tokens, completion_tokens,
           audio_seconds::float8, cost_usd::text, cost_usd_precise::text
      from public.model_usage where purpose = ${purpose} order by id`).rows;
}

Deno.test("precise usage: real producer round-trips ten tiny calls under the existing writer role", async () => {
  await fixture(async (db, purpose) => {
    await db.queryArray("set local role service_role");
    for (let i = 0; i < 10; i++) await produce(db, purpose, 6);
    const totals = (await db.queryObject<{ calls: string; legacy: string; precise: string }>`
      select count(*)::text as calls, sum(cost_usd)::text as legacy,
             sum(coalesce(cost_usd_precise, cost_usd))::text as precise
        from public.model_usage where purpose = ${purpose}`).rows[0];
    assertEquals(totals, { calls: "10", legacy: "0.000000", precise: "0.000001200000" });
    const stored = await rows(db, purpose);
    assertEquals(stored.map((r) => r.cost_usd_precise), Array(10).fill("0.000000120000"));
    assertEquals(summarizeUsage(stored).total_usd, 0.0000012);
  });
});

Deno.test("precise usage: mixed old/new/zero/unknown rows aggregate without repricing old history", async () => {
  await fixture(async (db, purpose) => {
    await db.queryArray`
      insert into public.model_usage(created_at, kind, purpose, cost_usd)
      values (${AT}, 'embedding', ${purpose}, 1.234567)`;
    const original = (await db.queryObject<{ value: unknown }>`
      select to_jsonb(u) as value from public.model_usage u where purpose = ${purpose}`).rows[0].value;
    await produce(db, purpose, 6);
    await produce(db, purpose, 0);
    await produce(db, purpose, 6, "synthetic-unpriced-model");
    const stored = await rows(db, purpose);
    assertEquals(stored[0].cost_usd_precise, null);
    assertEquals(stored[0].cost_usd, "1.234567");
    assertEquals(stored[2].cost_usd_precise, "0.000000000000");
    const summary = summarizeUsage(stored);
    assertEquals([summary.total_usd, summary.calls, summary.unpriced_calls], [1.23456712, 4, 1]);
    const sum = (await db.queryObject<{ value: string }>`
      select sum(coalesce(cost_usd_precise, cost_usd))::text as value
        from public.model_usage where purpose = ${purpose}`).rows[0].value;
    assertEquals(sum, "1.234567120000");
    const after = (await db.queryObject<{ value: unknown }>`
      select to_jsonb(u) as value from public.model_usage u where purpose = ${purpose} order by id limit 1`).rows[0]
      .value;
    assertEquals(after, original);
  });
});

Deno.test("precise usage: twelve fractional digits preserve the existing eight-digit integer range", async () => {
  await fixture(async (db, purpose) => {
    const stored = (await db.queryObject<{ old: string; precise: string }>`
      insert into public.model_usage(kind, purpose, cost_usd, cost_usd_precise)
      values ('other', ${purpose}, 99999999.999999, 99999999.999999999999)
      returning cost_usd::text as old, cost_usd_precise::text as precise`).rows[0];
    assertEquals(stored, { old: "99999999.999999", precise: "99999999.999999999999" });
    for (const column of ["cost_usd", "cost_usd_precise"]) {
      await db.queryArray("savepoint range_check");
      const error = await assertRejects(
        () => db.queryArray(`insert into public.model_usage(kind, ${column}) values ('other', 100000000)`),
        PostgresError,
      );
      assertEquals(error.fields.code, "22003");
      await db.queryArray("rollback to savepoint range_check");
    }
    // The old database scale independently reproduces the loss seen before this fix.
    const previous =
      (await db.queryObject<{ value: string }>`select (0.00000012::numeric(14, 6))::text as value`).rows[0];
    assertEquals(previous.value, "0.000000");
  });
});

Deno.test("precise usage: additive migration is idempotent and leaves legacy rows/type/writers intact", async () => {
  await fixture(async (db, purpose) => {
    await db
      .queryArray`insert into public.model_usage(kind, purpose, cost_usd) values ('other', ${purpose}, 12.345678)`;
    const before = (await db.queryObject<{ value: unknown }>`
      select to_jsonb(u) as value from public.model_usage u where purpose = ${purpose}`).rows[0].value;
    await db.queryArray(migration);
    await db.queryArray(migration);
    const after = (await db.queryObject<{ value: unknown }>`
      select to_jsonb(u) as value from public.model_usage u where purpose = ${purpose}`).rows[0].value;
    assertEquals(after, before);
    const columns = (await db.queryObject<{
      column_name: string;
      numeric_precision: number;
      numeric_scale: number;
      is_nullable: string;
      column_default: string | null;
    }>`select column_name, numeric_precision, numeric_scale, is_nullable, column_default
         from information_schema.columns where table_schema = 'public' and table_name = 'model_usage'
          and column_name in ('cost_usd', 'cost_usd_precise') order by column_name`).rows;
    assertEquals(columns, [
      { column_name: "cost_usd", numeric_precision: 14, numeric_scale: 6, is_nullable: "YES", column_default: null },
      {
        column_name: "cost_usd_precise",
        numeric_precision: 20,
        numeric_scale: 12,
        is_nullable: "YES",
        column_default: null,
      },
    ]);
    await db.queryArray("set local role service_role");
    await db.queryArray`insert into public.model_usage(kind, purpose, cost_usd) values ('other', ${purpose}, 0.02)`;
    const oldWriter = (await db.queryObject<{ precise: string | null }>`
      select cost_usd_precise::text as precise from public.model_usage where purpose = ${purpose} order by id desc limit 1`)
      .rows[0];
    assertEquals(oldWriter.precise, null);
  });
});

Deno.test("precise usage: actual loopback PostgREST returns exact text through the production cost projection", async () => {
  assertEquals(Deno.env.get("GITHUB_ACTIONS"), "true", "isolated GitHub CI fixture required");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(DB_URL).hostname), "isolated loopback database required");
  assertEquals(new URL(DB_URL).pathname, "/postgres", "known synthetic Supabase database required");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  assert(url && key, "isolated API fixture configuration required");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "isolated loopback API required");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
  const purpose = `precision752:postgrest:${crypto.randomUUID()}`;
  try {
    let inserted = false;
    await recordModelUsage(
      "https://api.openai.com/v1/embeddings",
      {},
      new Response(JSON.stringify({ model: "text-embedding-3-small", usage: { prompt_tokens: 6 } })),
      { purpose },
      async (actual) => {
        const { error } = await db.from("model_usage").insert(actual);
        inserted = error === null;
        return { error };
      },
    );
    assert(inserted, "actual producer row was not inserted into the isolated API");
    const { error } = await db.from("model_usage").insert([
      { kind: "other", purpose, cost_usd: "99999999.999999", cost_usd_precise: "99999999.999999999999" },
      { kind: "other", purpose, cost_usd: "1.234567" },
    ]);
    assertEquals(error?.code ?? null, null);
    const response = await db.from("model_usage").select(USAGE_COST_COLUMNS).eq("purpose", purpose).order("id");
    assertEquals(response.error?.code ?? null, null);
    const actual = response.data as StoredUsageCost[];
    assertEquals(actual.length, 3);
    assertEquals(actual[0], { cost_usd: "0.000000", cost_usd_precise: "0.000000120000" });
    assertEquals(actual[1], { cost_usd: "99999999.999999", cost_usd_precise: "99999999.999999999999" });
    assertEquals(recordedUsageUnits(actual[1]), 99_999_999_999_999_999_999n);
    assertEquals(actual[2], { cost_usd: "1.234567", cost_usd_precise: null });
  } finally {
    const cleanup = await db.from("model_usage").delete().eq("purpose", purpose);
    assertEquals(cleanup.error?.code ?? null, null);
    const remaining = await db.from("model_usage").select("id", { count: "exact", head: true }).eq("purpose", purpose);
    assertEquals(remaining.error?.code ?? null, null);
    assertEquals(remaining.count, 0);
  }
});
