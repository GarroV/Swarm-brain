// Real PostgreSQL regression on synthetic rows only. No remote/project database is accepted.
import { assert, assertEquals, AssertionError, assertRejects } from "@std/assert";
import { Client } from "postgres";

const url = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const migration = await Deno.readTextFile(
  new URL("../../migrations/20261113160000_demo_reset_people.sql", import.meta.url),
);
const original = await Deno.readTextFile(
  new URL("../../migrations/20260928180000_demo_auto_reset.sql", import.meta.url),
);
const oldFunction = original.slice(
  original.indexOf("create or replace function public.demo_reset()"),
  original.indexOf("\n$$;", original.indexOf("create or replace function public.demo_reset()")) + 4,
);

Deno.test("demo_reset people: old body RED, current cleanup, account/other preservation and real mutant", async () => {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "loopback fixture database required");
  const db = new Client(url);
  await db.connect();
  try {
    await db.queryArray("begin");
    await db.queryArray("select pg_advisory_xact_lock(hashtext('public.demo_reset'))");
    await db.queryArray("select public.demo_reset()");
    const other = "test_demo_people_reset_883";
    await db.queryArray`insert into public.workspaces(id,name) values (${other}, 'Fictional reset fixture')`;
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [i, source] of ["manual", "calendar", "transcript"].entries()) {
      await db.queryArray`insert into public.people(id,group_id,display_name,source) values (${
        ids[i]
      }, 'demo', 'Fictional visitor', ${source})`;
    }
    const kept = crypto.randomUUID();
    await db
      .queryArray`insert into public.people(id,group_id,display_name,source) values (${kept}, ${other}, 'Fictional other', 'manual')`;
    const accounts = await db.queryObject<{ id: string }>(
      "select id from public.people where group_id='demo' and source='account' order by id",
    );
    assert(accounts.rows.length > 0, "account trigger fixture missing");
    const count = async () =>
      (await db.queryObject<{ n: number }>`select count(*)::int as n from public.people where id=any(${ids})`).rows[0]
        .n;

    await db.queryArray("savepoint baseline");
    await db.queryArray(oldFunction);
    await db.queryArray("select public.demo_reset()");
    assertEquals(await count(), 3, "old broken input did not reproduce");
    await assertRejects(async () => assertEquals(await count(), 0), AssertionError);
    console.log("demo people baseline: RED, 3 synthetic rows remain instead of 0");
    await db.queryArray("rollback to baseline");

    const body = async () =>
      (await db.queryObject<{ source: string }>(
        "select pg_get_functiondef('public.demo_reset()'::regprocedure) as source",
      )).rows[0].source;
    const before = await body();
    await db.queryArray(migration);
    assertEquals(await body(), before, "reapplying the patch must be idempotent");
    await db.queryArray("select public.demo_reset()");
    assertEquals(await count(), 0);
    assertEquals(
      (await db.queryObject<{ id: string }>(
        "select id from public.people where group_id='demo' and source='account' order by id",
      )).rows,
      accounts.rows,
    );
    assertEquals((await db.queryObject<{ id: string }>`select id from public.people where id=${kept}`).rows, [{
      id: kept,
    }]);

    await db.queryArray("savepoint mutant");
    const changed = before.replace(
      "where group_id = c_ws and source <> 'account';",
      "where group_id = c_ws and false;",
    );
    assert(changed !== before, "SQL mutation did not apply");
    await db.queryArray(changed);
    assertEquals(await body(), changed);
    await db.queryArray`insert into public.people(id,group_id,display_name,source) values (${
      ids[0]
    }, 'demo', 'Fictional mutant visitor', 'manual')`;
    await db.queryArray("select public.demo_reset()");
    assertEquals(await count(), 1, "mutant did not reproduce the missing cleanup");
    await assertRejects(async () => assertEquals(await count(), 0), AssertionError);
    console.log("demo people SQL mutant: RED, disabled cleanup leaves 1 synthetic row");
    await db.queryArray("rollback to mutant");
    assertEquals(await body(), before);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});
