// Demo seed regression on a loopback CI database, with the actual pure frontend plan consumer.
import {
  assert,
  assertEquals,
  AssertionError,
  assertRejects,
} from "@std/assert";
import { Client } from "postgres";
import { buildPlan } from "../src/lib/sprintPlan.ts";
import type { Project, Task } from "../src/types.ts";

const url = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const migration = await Deno.readTextFile(
  new URL(
    "../../supabase/migrations/20261113161000_demo_reset_space_plan.sql",
    import.meta.url,
  ),
);
const original = await Deno.readTextFile(
  new URL(
    "../../supabase/migrations/20260928180000_demo_auto_reset.sql",
    import.meta.url,
  ),
);
const oldFunction = original.slice(
  original.indexOf("create or replace function public.demo_reset()"),
  original.indexOf(
    "\n$$;",
    original.indexOf("create or replace function public.demo_reset()"),
  ) + 4,
);
const SPACE = "d0000000-0000-4000-8000-000000000002";
const CYCLE = "d0000000-0000-4000-8000-000000000304";

Deno.test("demo_reset plan: old seed RED, real plan totals and mutant, reapply preserves independent extension", async () => {
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "loopback fixture database required",
  );
  const db = new Client(url);
  await db.connect();
  try {
    await db.queryArray("begin");
    await db.queryArray(
      "select pg_advisory_xact_lock(hashtext('public.demo_reset'))",
    );
    const body = async () =>
      (await db.queryObject<{ source: string }>(
        "select pg_get_functiondef('public.demo_reset()'::regprocedure) as source",
      )).rows[0].source;
    const plan = async () => {
      const tasks = (await db.queryObject<{ value: Task }>(
        "select to_jsonb(t) as value from public.tasks t where group_id='demo'",
      ))
        .rows.map((row) => row.value);
      const projects = (await db.queryObject<{ value: Project }>(
        "select to_jsonb(p) as value from public.projects p where group_id='demo'",
      ))
        .rows.map((row) => row.value);
      const active = (await db.queryObject<
        { task_id: string }
      >`select task_id from public.sprint_items where cycle_id=${CYCLE} and task_id is not null and withdrawn_at is null and moved_at is null`)
        .rows;
      return buildPlan(
        tasks,
        projects,
        SPACE,
        new Set(active.map((row) => row.task_id)),
      );
    };
    const before = await body();
    await db.queryArray("savepoint baseline");
    await db.queryArray(oldFunction);
    await db.queryArray("select public.demo_reset()");
    assertEquals(
      (await plan()).groups.length,
      0,
      "old empty plan did not reproduce",
    );
    await assertRejects(
      async () => assertEquals((await plan()).groups.length, 3),
      AssertionError,
    );
    console.log("demo plan baseline: RED, 0 groups instead of 3");
    await db.queryArray("rollback to baseline");

    await db.queryArray("select public.demo_reset()");
    const value = await plan();
    assertEquals(value.groups.map((g) => [g.project.name, g.total, g.done]), [
      ["Autumn menu", 4, 2],
      ["Loyalty wallet", 4, 2],
      ["Peak-hour service", 6, 2],
    ]);
    assertEquals({
      total: value.total,
      done: value.done,
      available: value.available,
    }, {
      total: 14,
      done: 6,
      available: 6,
    });
    const totals = (await db.queryObject<{ tasks: number; projects: number }>(
      "select (select count(*)::int from public.tasks where group_id='demo') as tasks,(select count(*)::int from public.projects where group_id='demo') as projects",
    )).rows[0];
    assertEquals(totals, { tasks: 46, projects: 17 });
    const orphans = (await db.queryObject<{ n: number }>(
      "select count(*)::int as n from public.tasks t join public.tasks p on p.id=t.parent_id where t.group_id='demo' and t.project_id<>p.project_id",
    )).rows[0].n;
    assertEquals(orphans, 0, "seed move split a parent/child family");
    await db.queryArray(migration);
    assertEquals(
      await body(),
      before,
      "reapplying the exact seed patch changed the definition",
    );

    await db.queryArray("savepoint mutant");
    const changed = before.replaceAll(
      "false, true, 900000001)",
      "false, false, 900000001)",
    );
    assert(changed !== before, "SQL mutation did not apply");
    await db.queryArray(changed);
    assertEquals(await body(), changed);
    await db.queryArray("select public.demo_reset()");
    assertEquals((await plan()).groups.length, 0);
    await assertRejects(
      async () => assertEquals((await plan()).groups.length, 3),
      AssertionError,
    );
    console.log(
      "demo plan SQL mutant: RED, unmarked groups produce empty plan",
    );
    await db.queryArray("rollback to mutant");
    assertEquals(await body(), before);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});
