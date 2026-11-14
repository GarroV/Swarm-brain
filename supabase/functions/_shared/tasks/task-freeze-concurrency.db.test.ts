// #814 lock order: actual isolated transactions, never a shared or production database.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const url = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!["127.0.0.1", "localhost", "db", "supabase_db_swarm-brain"].includes(new URL(url).hostname)) {
  throw new Error("814 concurrency fixture requires an isolated database");
}
const WS = "t_freeze814_locks";
async function seed(db: Client) {
  await db.queryArray`delete from sprint_cycles where group_id=${WS}`;
  await db.queryArray`delete from tasks where group_id=${WS}`;
  await db.queryArray`delete from sprints where group_id=${WS}`;
  await db
    .queryArray`insert into workspaces(id,name) values(${WS},'Fictional lock fixture') on conflict(id) do nothing`;
  const tab = (await db.queryObject<{ id: string }>`insert into sprints(group_id,name,kind,status,start_date,end_date)
    values(${WS},'Fictional space','space','active',current_date-13,current_date) returning id`).rows[0].id;
  const cycle =
    (await db.queryObject<{ id: string }>`insert into sprint_cycles(group_id,tab_id,name,start_date,end_date,status)
    values(${WS},${tab},'Fictional cycle',current_date-13,current_date,'active') returning id`).rows[0].id;
  const task = (await db.queryObject<
    { id: string }
  >`insert into tasks(title,status,group_id) values('Fictional task','open',${WS}) returning id`).rows[0].id;
  await db.queryArray`insert into sprint_items(cycle_id,task_id,in_plan) values(${cycle},${task},true)`;
  return { cycle, task };
}
const review = (db: Client, f: { cycle: string; task: string }) =>
  db.queryObject<{ id: string | null; invoker: string }>`
  select public.update_sprint_item_check(${f.cycle}::uuid,${f.task}::uuid,${WS},'{"check_status":"risk"}'::jsonb) as id,
    current_user as invoker`;
async function begin(db: Client) {
  await db.queryArray("begin");
  await db.queryArray("set local statement_timeout='4s'");
  await db.queryArray("set local role service_role");
}
async function blocked(db: Client, blocker: number, waiting: number) {
  for (let i = 0; i < 100; i++) {
    const r = await db.queryObject<
      { yes: boolean }
    >`select ${blocker}::integer=any(pg_blocking_pids(${waiting}::integer)) as yes`;
    if (r.rows[0].yes) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected fixture lock contention was not observed");
}
async function clients() {
  const a = new Client(url), b = new Client(url), watch = new Client(url);
  await a.connect();
  await b.connect();
  await watch.connect();
  const pid = async (db: Client) =>
    (await db.queryObject<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
  return { a, b, watch, apid: await pid(a), bpid: await pid(b) };
}

Deno.test("814 busy freeze returns a bounded review conflict under service_role", async () => {
  const c = await clients();
  try {
    const f = await seed(c.watch);
    await begin(c.a);
    await begin(c.b);
    await c.a.queryArray`update tasks set frozen_at=now() where id=${f.task}`;
    const waiting = review(c.b, f).then((r) => ({ r, code: null }), (e) => ({ r: null, code: e.fields?.code }));
    assertEquals((await waiting).code, "PT409");
    await c.b.queryArray("rollback");
    await c.a.queryArray("commit");
    assertEquals(
      (await c.watch.queryObject<
        { status: string | null }
      >`select check_status as status from sprint_items where task_id=${f.task}`).rows[0].status,
      null,
    );
  } finally {
    await c.a.end();
    await c.b.end();
    await c.watch.end();
  }
});

Deno.test("814 busy task conflict lets archive complete without a reverse-order wait", async () => {
  const c = await clients();
  try {
    const f = await seed(c.watch);
    await begin(c.a);
    await begin(c.b);
    // Hold only the task first, so the concurrent RPC must wait before acquiring the item.
    await c.a.queryArray`update tasks set updated_at=now() where id=${f.task}`;
    const waiting = review(c.b, f).then((r) => ({ r, code: null }), (e) => ({ r: null, code: e.fields?.code }));
    const result = await waiting;
    assertEquals(result.code, "PT409");
    await c.b.queryArray("rollback");
    // The existing archive trigger can take the item after the bounded conflict.
    await c.a.queryArray`update tasks set archived_at=now() where id=${f.task}`;
    await c.a.queryArray("commit");
    assert(
      (await c.watch.queryObject<
        { archived: boolean }
      >`select archived_at is not null as archived from tasks where id=${f.task}`).rows[0].archived,
    );
  } finally {
    await c.a.end();
    await c.b.end();
    await c.watch.end();
  }
});

Deno.test("814 review then freeze retains the earlier mark but excludes the newly frozen task", async () => {
  const c = await clients();
  try {
    const f = await seed(c.watch);
    await begin(c.a);
    await begin(c.b);
    assertEquals((await review(c.a, f)).rows[0].invoker, "service_role");
    const waiting = c.b.queryArray`update tasks set frozen_at=now() where id=${f.task}`;
    await blocked(c.watch, c.apid, c.bpid);
    await c.a.queryArray("commit");
    await waiting;
    await c.b.queryArray("commit");
    const row = (await c.watch.queryObject<
      { frozen: boolean; status: string }
    >`select t.frozen_at is not null as frozen,si.check_status as status
      from tasks t join sprint_items si on si.task_id=t.id where t.id=${f.task}`).rows[0];
    assertEquals(row, { frozen: true, status: "risk" });
  } finally {
    await c.a.end();
    await c.b.end();
    await c.watch.end();
  }
});

/** Execute the real RPC as its production invoker, restoring role/transaction on error too. */
async function serviceReview(db: Client, f: { cycle: string; task: string }) {
  await db.queryArray("savepoint fixture_invoker");
  try {
    await db.queryArray("set local role service_role");
    const result = await review(db, f);
    await db.queryArray("reset role");
    await db.queryArray("release savepoint fixture_invoker");
    return result;
  } catch (e) {
    await db.queryArray("rollback to savepoint fixture_invoker");
    await db.queryArray("release savepoint fixture_invoker");
    throw e;
  }
}

Deno.test("814 the actual review guard mutant demonstrably permits the forbidden frozen mark", async () => {
  const db = new Client(url);
  await db.connect();
  try {
    const f = await seed(db);
    await db.queryArray`update tasks set frozen_at=now() where id=${f.task}`;
    await db.queryArray("begin");
    const definition = async () =>
      (await db.queryObject<
        { body: string }
      >`select pg_get_functiondef('public.update_sprint_item_check(uuid,uuid,text,jsonb)'::regprocedure) as body`)
        .rows[0].body;
    const original = await definition();
    let rejected: string | null = null;
    try {
      await serviceReview(db, f);
    } catch (e) {
      rejected = e && typeof e === "object" && "fields" in e ? (e.fields as { code?: string })?.code ?? null : null;
    }
    assertEquals(rejected, "PT409");
    const marker = "if task_frozen_at is not null then";
    assertEquals(original.split(marker).length, 2);
    const mutant = original.replace(marker, "if false then");
    await db.queryArray(mutant);
    assert((await definition()).includes("if false then"), "mutant was not actually applied");
    assert((await definition()) !== original);
    const wrong = await serviceReview(db, f);
    assertEquals(wrong.rows[0].invoker, "service_role");
    assert(wrong.rows[0].id !== null, "expected RED counterexample did not reach the write");
    assertEquals(
      (await db.queryObject<
        { status: string }
      >`select check_status as status from sprint_items where task_id=${f.task}`).rows[0].status,
      "risk",
    );
    console.log("EXPECTED_RED FrozenCheckGuardBypass; actual mutant write observed");
    await db.queryArray("rollback");
    assertEquals(await definition(), original);
  } finally {
    await db.end();
  }
});

Deno.test("814 old acceptance loses freeze; the current snapshot capture and repeated migration restore it", async () => {
  const db = new Client(url);
  await db.connect();
  try {
    const f = await seed(db);
    await db.queryArray`update tasks set frozen_at=now() where id=${f.task}`;
    const definition = async () =>
      (await db.queryObject<
        { body: string }
      >`select pg_get_functiondef('public.accept_sprint_cycle(uuid,text,text,text,jsonb,text,date,date,date)'::regprocedure) as body`)
        .rows[0].body;
    const original = await definition();
    const marker = "frozen_due_date     = t.due_date,\n         task_frozen        = t.frozen_at is not null";
    assertEquals(original.split(marker).length, 2);
    const legacy = original.replace(marker, "frozen_due_date     = t.due_date");
    await db.queryArray("begin");
    await db.queryArray(legacy);
    assert((await definition()) !== original, "legacy acceptance was not installed in the isolated transaction");
    const accept = async () => {
      await db.queryArray("set local role service_role");
      await db.queryObject`select public.accept_sprint_cycle(${f.cycle}::uuid,${WS},'Fictional Person',null,'{}'::jsonb,
        'Fictional next',current_date+1,current_date+14,current_date+7)`;
      await db.queryArray("reset role");
      return (await db.queryObject<
        { task_frozen: boolean }
      >`select task_frozen from sprint_items where cycle_id=${f.cycle}`).rows[0].task_frozen;
    };
    assertEquals(await accept(), false, "old acceptance counterexample no longer reproduces");
    console.log("EXPECTED_RED LegacyAcceptanceDropsTaskFreeze; actual old SQL observed");
    await db.queryArray("rollback");
    assertEquals(await definition(), original);
    await db.queryArray("begin");
    assertEquals(await accept(), true);
    await db.queryArray("rollback");
    // Idempotent forward patch: reapplying the owned migration cannot rewrite snapshots.
    await db.queryArray("begin");
    const migration = await Deno.readTextFile(
      new URL("../../../migrations/20261114110000_task_freeze.sql", import.meta.url),
    );
    await db.queryArray(migration);
    assertEquals(await definition(), original);
    await db.queryArray("rollback");
  } finally {
    await db.end();
  }
});

const checkedAccept = (db: Client, f: { cycle: string; task: string }) =>
  db.queryObject<{ result: unknown; invoker: string }>`
  select public.accept_sprint_cycle_with_freeze(${f.cycle}::uuid,${WS},'Fictional Person',null,'{"plan":1}'::jsonb,
    'Fictional next',current_date+1,current_date+14,current_date+7,${
    JSON.stringify({ [f.task]: false })
  }::jsonb) as result,
    current_user as invoker`;
async function serviceAccept(db: Client, f: { cycle: string; task: string }) {
  await db.queryArray("savepoint fixture_accept");
  try {
    await db.queryArray("set local role service_role");
    const result = await checkedAccept(db, f);
    await db.queryArray("reset role");
    await db.queryArray("release savepoint fixture_accept");
    return result;
  } catch (e) {
    await db.queryArray("rollback to savepoint fixture_accept");
    await db.queryArray("release savepoint fixture_accept");
    throw e;
  }
}
const errorCode = (e: unknown) =>
  e && typeof e === "object" && "fields" in e ? (e.fields as { code?: string })?.code : null;

for (const heldRow of ["item", "cycle"] as const) {
  Deno.test(`814 ${heldRow}-first maintenance receives a bounded conflict from review/acceptance and can finish`, async () => {
    const c = await clients();
    try {
      const f = await seed(c.watch);
      await begin(c.a);
      await c.b.queryArray("begin");
      await c.b.queryArray("set local statement_timeout='4s'");
      await c.b.queryArray("set local lock_timeout='37s'");
      if (heldRow === "item") await c.a.queryArray`select id from sprint_items where cycle_id=${f.cycle} for update`;
      else await c.a.queryArray`select id from sprint_cycles where id=${f.cycle} for update`;
      let code: string | null | undefined = null;
      try {
        await serviceAccept(c.b, f);
      } catch (e) {
        code = errorCode(e);
      }
      assertEquals(code, "PT409");
      assertEquals(
        (await c.b.queryObject<{ value: string }>("select current_setting('lock_timeout') as value")).rows[0].value,
        "37s",
      );
      if (heldRow === "item") {
        code = null;
        try {
          await serviceReview(c.b, f);
        } catch (e) {
          code = errorCode(e);
        }
        assertEquals(code, "PT409");
      }
      // With the other RPC rolled back, maintenance can take its later task lock.
      await c.a.queryArray`select id from tasks where id=${f.task} for update nowait`;
      await c.a.queryArray("commit");
      await c.b.queryArray("rollback");
    } finally {
      await c.a.end();
      await c.b.end();
      await c.watch.end();
    }
  });
}

for (const [setting, effective] of [["0", "250ms"], ["80ms", "80ms"], ["37s", "250ms"]]) {
  Deno.test(`814 acceptance bounds base locks and restores caller timeout ${setting} exactly`, async () => {
    const db = new Client(url);
    await db.connect();
    try {
      const f = await seed(db);
      await db.queryArray("begin");
      await db.queryArray`select set_config('lock_timeout',${setting},true)`;
      const original = (await db.queryObject<
        { body: string }
      >`select pg_get_functiondef('public.accept_sprint_cycle(uuid,text,text,text,jsonb,text,date,date,date)'::regprocedure) as body`)
        .rows[0].body;
      const marker = "\nbegin\n";
      assert(original.includes(marker));
      const instrumented = original.replace(
        marker,
        `${marker}  if current_setting('lock_timeout') <> '${effective}' then raise exception 'Unexpected effective fixture timeout'; end if;\n`,
      );
      await db.queryArray(instrumented);
      const result = await serviceAccept(db, f);
      assertEquals(result.rows[0].invoker, "service_role");
      assertEquals(
        (await db.queryObject<{ value: string }>("select current_setting('lock_timeout') as value")).rows[0].value,
        setting,
      );
      await db.queryArray("rollback");
      assertEquals(
        (await db.queryObject<
          { body: string }
        >`select pg_get_functiondef('public.accept_sprint_cycle(uuid,text,text,text,jsonb,text,date,date,date)'::regprocedure) as body`)
          .rows[0].body,
        original,
      );
    } finally {
      await db.end();
    }
  });
}

Deno.test("814 a busy carry target rolls back all base writes and restores caller timeout", async () => {
  const c = await clients();
  try {
    const f = await seed(c.watch);
    const next = (await c.watch.queryObject<
      { id: string }
    >`insert into sprint_cycles(group_id,tab_id,name,start_date,end_date,status)
      select group_id,tab_id,'Fictional existing next',current_date+1,current_date+14,'draft' from sprint_cycles where id=${f.cycle} returning id`)
      .rows[0].id;
    await begin(c.a);
    await c.a.queryArray`select id from sprint_cycles where id=${next} for update`;
    await c.b.queryArray("begin");
    await c.b.queryArray("set local statement_timeout='4s'");
    await c.b.queryArray("set local lock_timeout='0'");
    let code: string | null | undefined = null;
    try {
      await serviceAccept(c.b, f);
    } catch (e) {
      code = errorCode(e);
    }
    assertEquals(code, "PT409");
    assertEquals(
      (await c.b.queryObject<{ value: string }>("select current_setting('lock_timeout') as value")).rows[0].value,
      "0",
    );
    const state = (await c.watch.queryObject<
      { status: string; stats: unknown; snapshot: boolean }
    >`select c.status,c.stats,si.frozen_at is not null as snapshot
      from sprint_cycles c join sprint_items si on si.cycle_id=c.id where c.id=${f.cycle}`).rows[0];
    assertEquals(state, { status: "active", stats: null, snapshot: false });
    await c.a.queryArray`select id from tasks where id=${f.task} for update nowait`;
    await c.a.queryArray("commit");
    await c.b.queryArray("rollback");
  } finally {
    await c.a.end();
    await c.b.end();
    await c.watch.end();
  }
});
