// Exact phase-two SQL, isolated CI only. No application/server or production database is started here.
import { assert, assertEquals, AssertionError, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MIGRATION = new URL("../../../migrations/20261114235000_drop_unused_task_created_by.sql", import.meta.url);
const AUTHOR = 8238001;
const migrationSQL = () => Deno.readTextFile(MIGRATION);

function loopback(url: string) {
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Isolated loopback database/API required",
  );
}
loopback(DB_URL);
assertEquals(Deno.env.get("GITHUB_ACTIONS"), "true", "Isolated GitHub CI fixture required");
assertEquals(new URL(DB_URL).pathname, "/postgres", "Known synthetic Supabase database required");

async function connect() {
  const db = new Client(DB_URL);
  await db.connect();
  return db;
}
async function scalar<T>(db: Client, sql: string, args: unknown[] = []): Promise<T> {
  return (await db.queryObject<{ value: T }>(sql, args)).rows[0].value;
}
const columnExists = (db: Client) =>
  scalar<boolean>(
    db,
    `select exists (
  select 1 from pg_attribute where attrelid='public.tasks'::regclass
  and attname='created_by' and attnum>0 and not attisdropped) as value`,
  );

async function seedTask(db: Client, ws: string) {
  await db.queryArray("insert into workspaces(id,name) values($1,'Synthetic migration workspace')", [ws]);
  return await scalar<string>(
    db,
    `insert into tasks(title,group_id,created_by_telegram_id,confirmed)
    values('Synthetic migration task',$1,$2,true) returning id as value`,
    [ws, AUTHOR],
  );
}
const creatorOf = (db: Client, id: string) =>
  scalar<string>(db, "select created_by_telegram_id::text as value from tasks where id=$1::uuid", [id]);
const taskWithoutLegacy = (db: Client, id: string) =>
  scalar<Record<string, unknown>>(db, "select to_jsonb(t)-'created_by' as value from tasks t where id=$1::uuid", [id]);

async function legacyFixture(
  fn: (db: Client, id: string) => Promise<void>,
  isolation = "read committed",
) {
  assert(["read committed", "read uncommitted", "repeatable read", "serializable"].includes(isolation));
  const db = await connect();
  try {
    await db.queryArray("begin isolation level " + isolation);
    await db.queryArray("alter table public.tasks add column if not exists created_by text not null default 'system'");
    const id = await seedTask(db, "test-created-by-238-" + crypto.randomUUID());
    await fn(db, id);
  } finally {
    try {
      await db.queryArray("rollback");
    } finally {
      await db.end();
    }
  }
}

type Outcome = { code: string | null; dropped: boolean };
async function attempt(db: Client, sql: string): Promise<Outcome> {
  await db.queryArray("savepoint migration_attempt");
  let code: string | null = null, dropped = false;
  try {
    try {
      await db.queryArray(sql);
      dropped = !await columnExists(db);
    } catch (error) {
      code = (error as { fields?: { code?: string } }).fields?.code ?? "UNEXPECTED_ERROR";
    }
  } finally {
    await db.queryArray("rollback to savepoint migration_attempt");
    await db.queryArray("release savepoint migration_attempt");
  }
  return { code, dropped };
}
function rejected(outcome: Outcome, code: string) {
  assertEquals(outcome.code, code, "Migration must reject before dropping the legacy column");
  assertEquals(outcome.dropped, false);
}
function replaceOnce(sql: string, from: string, to: string) {
  assertEquals(sql.split(from).length, 2, "Negative control must change one actual SQL condition");
  return sql.replace(from, to);
}

Deno.test("created_by removal drops only the constant column, preserves every other field, and is idempotent", async () => {
  for (const isolation of ["read committed", "read uncommitted"]) {
    await legacyFixture(async (db, id) => {
      const before = await taskWithoutLegacy(db, id);
      const sql = await migrationSQL();
      await db.queryArray(sql);
      assertEquals(await columnExists(db), false);
      assertEquals(await taskWithoutLegacy(db, id), before);
      assertEquals(await creatorOf(db, id), String(AUTHOR));
      await db.queryArray(sql);
      assertEquals(await columnExists(db), false);
      assertEquals(await taskWithoutLegacy(db, id), before);
    }, isolation);
  }
});

Deno.test("created_by removal refuses non-system and NULL values and rolls back without touching the real creator", async () => {
  for (const value of ["synthetic-non-system", null]) {
    await legacyFixture(async (db, id) => {
      if (value === null) await db.queryArray("alter table tasks alter column created_by drop not null");
      await db.queryArray("update tasks set created_by=$2 where id=$1::uuid", [id, value]);
      const before = await taskWithoutLegacy(db, id);
      rejected(await attempt(db, await migrationSQL()), "23514");
      assertEquals(await columnExists(db), true);
      assertEquals(await scalar(db, "select created_by as value from tasks where id=$1::uuid", [id]), value);
      assertEquals(await taskWithoutLegacy(db, id), before);
    });
  }
});

Deno.test("created_by removal retains dependent views instead of cascading them away", async () => {
  await legacyFixture(async (db, id) => {
    await db.queryArray("create temporary view created_by_238_dependency as select created_by from public.tasks");
    rejected(await attempt(db, await migrationSQL()), "2BP01");
    assertEquals(await columnExists(db), true);
    assertEquals(
      await scalar(db, "select count(*)::int as value from created_by_238_dependency"),
      await scalar(db, "select count(*)::int as value from tasks"),
    );
    assertEquals(await creatorOf(db, id), String(AUTHOR));
  });
});

Deno.test("created_by removal rejects stale-snapshot isolation without changing the column or creator", async () => {
  for (const level of ["repeatable read", "serializable"]) {
    await legacyFixture(async (db, id) => {
      const before = await taskWithoutLegacy(db, id);
      rejected(await attempt(db, await migrationSQL()), "25001");
      assertEquals(await columnExists(db), true);
      assertEquals(await taskWithoutLegacy(db, id), before);
    }, level);
  }
});

Deno.test("negative control: bypassing the actual constant guard loses the corrupt value and the contract catches it", async () => {
  await legacyFixture(async (db, id) => {
    await db.queryArray("update tasks set created_by='synthetic-non-system' where id=$1::uuid", [id]);
    const mutated = replaceOnce(await migrationSQL(), "created_by is distinct from 'system'", "false");
    const result = await attempt(db, mutated);
    assertEquals(
      result,
      { code: null, dropped: true },
      "Mutant must execute valid SQL and actually drop the corrupt column",
    );
    await assertRejects(() => Promise.resolve().then(() => rejected(result, "23514")), AssertionError);
    assertEquals(await columnExists(db), true, "Savepoint restores even the deliberately broken SQL");
    assertEquals(await creatorOf(db, id), String(AUTHOR));
  });
});

Deno.test("negative control: CASCADE would remove a real dependent view and the RESTRICT contract catches it", async () => {
  await legacyFixture(async (db) => {
    await db.queryArray("create temporary view created_by_238_dependency as select created_by from public.tasks");
    const mutated = replaceOnce(
      await migrationSQL(),
      "drop column created_by restrict",
      "drop column created_by cascade",
    );
    const result = await attempt(db, mutated);
    assertEquals(result, { code: null, dropped: true }, "Mutant must execute successfully, not fail on syntax");
    await assertRejects(() => Promise.resolve().then(() => rejected(result, "2BP01")), AssertionError);
    assertEquals(
      await scalar(db, "select to_regclass('pg_temp.created_by_238_dependency') is not null as value"),
      true,
    );
  });
});

function apiEnvironment() {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  assert(url && key, "Isolated CI Supabase environment required");
  loopback(url);
  return { url, key };
}

Deno.test("current create/list/sprint code works without tasks.created_by and preserves actual creator IDs", async () => {
  apiEnvironment();
  const db = await connect(), ws = "test-created-by-api-238-" + crypto.randomUUID();
  try {
    assertEquals(await columnExists(db), false, "Isolated schema must include the prepared migration");
    await db.queryArray("insert into workspaces(id,name) values($1,'Synthetic migration workspace')", [ws]);
    await db.queryArray(
      "insert into allowed_users(telegram_id,username,added_by,group_id) values($1,'synthetic238',0,$2)",
      [AUTHOR, ws],
    );
    const { createTask, listTasksWithTotal } = await import("./db.ts");
    const { createCycle } = await import("./sprint-cycles.ts");
    const { addItems, listItems } = await import("./sprint-items.ts");
    const task = await createTask({
      title: "Synthetic compatibility task",
      confirmed: true,
      created_by_telegram_id: AUTHOR,
    }, ws);
    assertEquals(task.created_by_telegram_id, AUTHOR);
    assertEquals(Object.hasOwn(task, "created_by"), false);
    const listed = await listTasksWithTotal({ viewerId: AUTHOR, createdBy: AUTHOR, confirmed: true }, ws);
    assertEquals(listed.tasks.map((t) => t.id), [task.id]);
    assertEquals(listed.tasks[0].created_by_telegram_id, AUTHOR);
    const cycle = await createCycle(
      { name: "Synthetic cycle", start_date: "2026-11-14", end_date: "2026-11-27" },
      ws,
      String(AUTHOR),
    );
    assertEquals(cycle.created_by, String(AUTHOR), "The other table's real creator is unchanged");
    assertEquals(await addItems(cycle.id, [task.id], ws, String(AUTHOR), AUTHOR), 1);
    assertEquals((await listItems(cycle.id, ws, { viewerId: AUTHOR })).map((item) => item.task_id), [task.id]);
    assertEquals(await creatorOf(db, task.id), String(AUTHOR));
  } finally {
    try {
      await db.queryArray("delete from sprint_cycles where group_id=$1", [ws]);
      await db.queryArray("delete from tasks where group_id=$1", [ws]);
      await db.queryArray("delete from allowed_users where group_id=$1 and telegram_id=$2", [ws, AUTHOR]);
      await db.queryArray("delete from workspaces where id=$1", [ws]);
    } finally {
      await db.end();
    }
  }
});

Deno.test("the current demo reset function can seed tasks with real creator IDs after the column is gone", async () => {
  const db = await connect();
  try {
    await db.queryArray("begin");
    assertEquals(await columnExists(db), false);
    await db.queryArray("select public.demo_reset()");
    const counts = await db.queryObject<{ total: number; with_creator: number }>(`select count(*)::int as total,
      count(created_by_telegram_id)::int as with_creator from tasks where group_id='demo'`);
    assert(counts.rows[0].total > 0);
    assert(counts.rows[0].with_creator > 0);
  } finally {
    try {
      await db.queryArray("rollback");
    } finally {
      await db.end();
    }
  }
});

// The test owns a temporary legacy column on the isolated database. Restore the migrated
// schema before returning, and wait for the existing PostgREST schema watcher after DDL.
async function waitForApiSchema() {
  const { url, key } = apiEnvironment(), deadline = performance.now() + 3000;
  let status = 0;
  do {
    const response = await fetch(url + "/rest/v1/tasks?select=*&limit=0", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    status = response.status;
    await response.arrayBuffer();
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (performance.now() < deadline);
  throw new Error("Isolated schema refresh did not settle: HTTP " + status);
}

async function restoreMigratedSchema(control: Client, ws: string) {
  await control.queryArray("delete from tasks where group_id=$1", [ws]);
  await control.queryArray("delete from workspaces where id=$1", [ws]);
  await control.queryArray("begin isolation level read committed");
  try {
    await control.queryArray(await migrationSQL());
    await control.queryArray("commit");
  } catch (error) {
    await control.queryArray("rollback");
    throw error;
  }
  await control.queryArray("notify pgrst, 'reload schema'");
  await waitForApiSchema();
}

async function concurrentOutcome(sql: string): Promise<Outcome> {
  const clients: Client[] = [], ws = "test-created-by-race-238-" + crypto.randomUUID();
  let columnAdded = false, pending: Promise<Outcome> | null = null;
  try {
    for (let i = 0; i < 3; i++) clients.push(await connect());
    const [control, writer, migrating] = clients;
    assertEquals(await columnExists(control), false, "The temporary column must be owned by this test");
    await control.queryArray("alter table tasks add column created_by text not null default 'system'");
    columnAdded = true;
    const id = await seedTask(control, ws);
    const writerPid = await scalar<number>(writer, "select pg_backend_pid() as value");
    const migratingPid = await scalar<number>(migrating, "select pg_backend_pid() as value");
    await writer.queryArray("begin");
    await writer.queryArray("update tasks set created_by='concurrent-non-system' where id=$1::uuid", [id]);
    await migrating.queryArray("begin isolation level read committed");
    pending = (async () => {
      try {
        await migrating.queryArray(sql);
        return { code: null, dropped: !await columnExists(migrating) };
      } catch (error) {
        return { code: (error as { fields?: { code?: string } }).fields?.code ?? "UNEXPECTED_ERROR", dropped: false };
      }
    })();
    const deadline = performance.now() + 4000;
    let blockedByWriter = false;
    do {
      const pids = await scalar<number[]>(control, "select pg_blocking_pids($1) as value", [migratingPid]);
      if (pids.includes(writerPid)) {
        blockedByWriter = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (performance.now() < deadline);
    assert(blockedByWriter, "Migration must wait for the real writer before it can drop the column");
    await writer.queryArray("commit");
    const result = await pending;
    await migrating.queryArray("rollback");
    assertEquals(await creatorOf(control, id), String(AUTHOR));
    return result;
  } finally {
    const [control, writer, migrating] = clients;
    try {
      // Never abandon a query while removing its fixtures/connections.
      if (writer) await writer.queryArray("rollback");
      if (pending) await pending;
      if (migrating) await migrating.queryArray("rollback");
      if (control && columnAdded) {
        await restoreMigratedSchema(control, ws);
      }
    } finally {
      for (const db of clients) await db.end();
    }
  }
}

Deno.test("writer committing while AX waits is rechecked before the actual migration can drop data", async () => {
  rejected(await concurrentOutcome(await migrationSQL()), "23514");
});

Deno.test("negative control: removing early AX makes the real concurrent guard fail", async () => {
  const mutated = replaceOnce(
    await migrationSQL(),
    "lock table public.tasks in access exclusive mode;",
    "-- negative control: early lock omitted",
  );
  const result = await concurrentOutcome(mutated);
  assertEquals(result, { code: null, dropped: true }, "Mutant must really reach DROP after the writer commits");
  await assertRejects(() => Promise.resolve().then(() => rejected(result, "23514")), AssertionError);
});
