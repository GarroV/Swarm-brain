// #814: actual isolated SQL + PostgREST lifecycle, snapshots and notification silence.
// Run only in the project's CI database. No production task or external send is involved.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!["127.0.0.1", "localhost", "db", "supabase_db_swarm-brain"].includes(new URL(DB_URL).hostname)) {
  throw new Error("814 fixture requires an isolated database");
}
for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Missing isolated fixture environment: ${name}`);
}
if (
  !["127.0.0.1", "localhost", "[::1]", "kong", "supabase_kong_swarm-brain"].includes(
    new URL(Deno.env.get("SUPABASE_URL")!).hostname,
  )
) {
  throw new Error("814 HTTP fixture requires the isolated API");
}
const { handleTaskArchiveRoutes } = await import("../../swarm-api/task-archive.ts");
const { getTask, getArchivedTask } = await import("./db.ts");
const { permanentlyDeleteTask, setTaskFrozen } = await import("./task-lifecycle.ts");
const { acceptCycle } = await import("./sprint-accept.ts");
const { listItems, updateItem } = await import("./sprint-items.ts");
const WS = "t_freeze814";
const OTHER = "t_freeze814_other";
const ACTOR = 900814;
const origin = "http://localhost";

async function seed(db: Client) {
  for (const ws of [WS, OTHER]) {
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
    await db
      .queryArray`insert into workspaces (id, name) values (${ws}, 'Fictional freeze fixture') on conflict (id) do nothing`;
  }
  await db
    .queryArray`insert into allowed_users (telegram_id, username, group_id, added_by) values (${ACTOR}, 'fictional814', ${WS}, 0) on conflict (telegram_id) do nothing`;
}
async function add(db: Client, opts: { archived?: boolean; ws?: string; recurring?: boolean } = {}) {
  const result = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, due_date, recur_freq, archived_at, remind_date, reminded_at, ping_delivered_to)
    values ('Fictional task', 'open', ${opts.ws ?? WS}, current_date - 2, ${opts.recurring ? "weekly" : null},
      ${opts.archived ? "2026-11-01T00:00:00Z" : null}::timestamptz, current_date + 1, now(), array[${ACTOR}]::bigint[])
    returning id`;
  return result.rows[0].id;
}
const route = (id: string, action: string, method: string, body?: unknown) =>
  handleTaskArchiveRoutes(
    new Request(`${origin}/tasks/${id}${action ? "/" + action : ""}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }),
    `/tasks/${id}${action ? "/" + action : ""}`,
    WS,
    origin,
    ACTOR,
  );

Deno.test("814 actual freeze/unfreeze is idempotent and never changes recurrence/reminders or queues human notifications", async () => {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await seed(db);
    const id = await add(db, { recurring: true });
    const state = async () =>
      (await db.queryObject<{ state: string }>`
      select (to_jsonb(t) - 'frozen_at' - 'frozen_by' - 'updated_at')::text as state from tasks t where id = ${id}`)
        .rows[0].state;
    const counts = async () =>
      (await db.queryObject<{ notifications: number; outbox: number; comments: number }>`
      select (select count(*)::int from notifications where group_id = ${WS}) as notifications,
        (select count(*)::int from telegram_outbox where group_id = ${WS}) as outbox,
        (select count(*)::int from task_comments where task_id = ${id}) as comments`).rows[0];
    const before = await state();
    const silent = await counts();
    assertEquals((await route(id, "freeze", "POST", { frozen: true }))?.status, 200);
    const frozen = await getTask(id);
    assert(frozen?.frozen_at);
    assertEquals(frozen.frozen_by, ACTOR);
    assertEquals(await state(), before);
    const history = async () =>
      (await db.queryObject<{ n: number }>`select count(*)::int as n from task_history where task_id = ${id}`).rows[0]
        .n;
    const firstHistory = await history();
    assert(firstHistory > 0);
    assertEquals((await route(id, "freeze", "POST", { frozen: true }))?.status, 200);
    assertEquals(await history(), firstHistory);
    assertEquals((await route(id, "freeze", "POST", { frozen: false }))?.status, 200);
    assertEquals((await getTask(id))?.frozen_at, null);
    assertEquals((await getTask(id))?.frozen_by, null);
    assertEquals(await state(), before);
    assertEquals(await counts(), silent);
    assertEquals((await route(id, "freeze", "POST", { frozen: "true" }))?.status, 400);
    const checked = await getTask(id);
    assert(checked);
    await db.queryArray`update tasks set group_id = ${OTHER} where id = ${id}`;
    await assertRejects(() => setTaskFrozen(checked, true, ACTOR));
    assertEquals((await getTask(id))?.frozen_at, null, "scope changed after guard: pause must not be written");
    const foreign = await add(db, { ws: OTHER });
    assertEquals((await route(foreign, "freeze", "POST", { frozen: true }))?.status, 404);
  } finally {
    await db.end();
  }
});

Deno.test("814 actual permanent delete requires the same archived version; restore/races and live tasks survive", async () => {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await seed(db);
    const live = await add(db);
    assertEquals((await route(live, "permanent", "DELETE"))?.status, 404);
    assert(await getTask(live));
    const id = await add(db, { archived: true });
    const snapshot = await getArchivedTask(id);
    assert(snapshot);
    assertEquals((await route(id, "restore", "POST"))?.status, 204);
    assertEquals(await permanentlyDeleteTask(snapshot), false);
    assert(await getTask(id));
    assertEquals((await route(id, "", "DELETE"))?.status, 204);
    assert(await getArchivedTask(id));
    assertEquals(
      await permanentlyDeleteTask(snapshot),
      false,
      "old archive generation cannot delete a re-archived task",
    );
    assertEquals((await route(id, "permanent", "DELETE"))?.status, 204);
    assertEquals(
      (await db.queryObject<{ n: number }>`select count(*)::int as n from tasks where id = ${id}`).rows[0].n,
      0,
    );
    const foreign = await add(db, { archived: true, ws: OTHER });
    assertEquals((await route(foreign, "permanent", "DELETE"))?.status, 404);
    assertEquals(
      (await db.queryObject<{ n: number }>`select count(*)::int as n from tasks where id = ${foreign}`).rows[0].n,
      1,
    );
  } finally {
    await db.end();
  }
});

Deno.test("814 future acceptance snapshots freeze, preserves real carry, and later unfreeze/delete cannot rewrite accepted results", async () => {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await seed(db);
    const tab = (await db.queryObject<
      { id: string }
    >`insert into sprints (group_id,name,kind,status,start_date,end_date) values (${WS},'Fictional space','space','active',current_date - 13,current_date) returning id`)
      .rows[0].id;
    const cycle = (await db.queryObject<
      { id: string }
    >`insert into sprint_cycles (group_id,tab_id,name,start_date,end_date,check_date,status)
      values (${WS},${tab},'Спринт 1 · 01.11 — 14.11',current_date - 13,current_date,current_date - 7,'active') returning id`)
      .rows[0].id;
    const id = await add(db);
    await db.queryArray`insert into sprint_items (cycle_id,task_id,in_plan) values (${cycle},${id},true)`;
    assertEquals((await route(id, "freeze", "POST", { frozen: true }))?.status, 200);
    await assertRejects(() => updateItem(cycle, id, WS, { check_status: "risk" }, "Fictional Person", ACTOR));
    assertEquals((await listItems(cycle, WS, "everyone"))[0].check_status, null);
    assertEquals((await route(id, "freeze", "POST", { frozen: false }))?.status, 200);
    assert(await updateItem(cycle, id, WS, { check_status: "ok" }, "Fictional Person", ACTOR));
    assertEquals((await route(id, "freeze", "POST", { frozen: true }))?.status, 200);
    const accepted = await acceptCycle(cycle, WS, "Fictional Person");
    assert(accepted?.next);
    const stats = accepted.cycle.stats as { plan: number; check_risk: number };
    assertEquals([stats.plan, stats.check_risk, accepted.carried_auto], [0, 0, 1]);
    const frozenRows = await listItems(cycle, WS, "everyone");
    assertEquals(frozenRows[0].task_frozen, true);
    const nextRows = await listItems(accepted.next.id, WS, "everyone");
    assertEquals(nextRows.some((i) => i.task_id === id && i.task_frozen === true), true);
    const acceptedState = async () =>
      (await db.queryObject<
        { snapshot: string }
      >`select jsonb_build_object('stats',c.stats,'row',to_jsonb(si) - 'task_id')::text as snapshot
      from sprint_cycles c join sprint_items si on si.cycle_id=c.id where c.id=${cycle}`).rows[0].snapshot;
    const before = await acceptedState();
    assertEquals((await route(id, "freeze", "POST", { frozen: false }))?.status, 200);
    assertEquals(await acceptedState(), before);
    assertEquals((await listItems(cycle, WS, "everyone"))[0].task_frozen, true);
    assertEquals((await route(id, "", "DELETE"))?.status, 204);
    assertEquals((await route(id, "permanent", "DELETE"))?.status, 204);
    assertEquals(await acceptedState(), before);
    assertEquals((await listItems(cycle, WS, "everyone"))[0].title, "Fictional task");
  } finally {
    await db.end();
  }
});

Deno.test("814 legacy accepted snapshots default false and do not follow a later live-task freeze", async () => {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await seed(db);
    const tab = (await db.queryObject<
      { id: string }
    >`insert into sprints (group_id,name,kind,status,start_date,end_date) values (${WS},'Fictional legacy space','space','active',current_date - 13,current_date) returning id`)
      .rows[0].id;
    const cycle = (await db.queryObject<
      { id: string }
    >`insert into sprint_cycles (group_id,tab_id,name,start_date,end_date,status,stats)
      values (${WS},${tab},'Fictional legacy accepted',current_date - 27,current_date - 14,'accepted','{"plan":1,"planPercent":0}'::jsonb) returning id`)
      .rows[0].id;
    const id = await add(db);
    await db
      .queryArray`insert into sprint_items (cycle_id,task_id,in_plan,frozen_at,frozen_title,frozen_status,frozen_assignees)
      values (${cycle},${id},true,now(),'Fictional legacy task','open',array[]::text[])`;
    const before = (await db.queryObject<
      { snapshot: string }
    >`select (to_jsonb(c))::text as snapshot from sprint_cycles c where id=${cycle}`).rows[0].snapshot;
    assertEquals((await listItems(cycle, WS, "everyone"))[0].task_frozen, false);
    assertEquals((await route(id, "freeze", "POST", { frozen: true }))?.status, 200);
    assertEquals((await listItems(cycle, WS, "everyone"))[0].task_frozen, false);
    assertEquals(
      (await db.queryObject<
        { snapshot: string }
      >`select (to_jsonb(c))::text as snapshot from sprint_cycles c where id=${cycle}`).rows[0].snapshot,
      before,
    );
  } finally {
    await db.end();
  }
});

for (const initialFrozen of [false, true]) {
  Deno.test(`814 acceptance race: ${initialFrozen ? "unfreeze" : "freeze"} between actual stats computation and actual SQL must not save inconsistent snapshots`, async () => {
    const db = new Client(DB_URL);
    await db.connect();
    const originalFetch = globalThis.fetch;
    try {
      await seed(db);
      const tab =
        (await db.queryObject<{ id: string }>`insert into sprints (group_id,name,kind,status,start_date,end_date)
        values (${WS},'Fictional race space','space','active',current_date-13,current_date) returning id`).rows[0].id;
      const cycle = (await db.queryObject<
        { id: string }
      >`insert into sprint_cycles (group_id,tab_id,name,start_date,end_date,check_date,status)
        values (${WS},${tab},'Спринт 1 · 01.11 — 14.11',current_date-13,current_date,current_date-7,'active') returning id`)
        .rows[0].id;
      const id = await add(db);
      await db.queryArray`insert into sprint_items(cycle_id,task_id,in_plan) values(${cycle},${id},true)`;
      if (initialFrozen) assertEquals((await route(id, "freeze", "POST", { frozen: true }))?.status, 200);
      let crossed = false;
      let computedPlan: number | null = null;
      globalThis.fetch = async (input, init) => {
        const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (!crossed && method === "POST" && requestUrl.pathname.endsWith("/rpc/accept_sprint_cycle")) {
          const body = typeof init?.body === "string"
            ? JSON.parse(init.body)
            : input instanceof Request
            ? await input.clone().json()
            : null;
          computedPlan = body?.p_stats?.plan ?? null;
          assertEquals(computedPlan, initialFrozen ? 0 : 1, "barrier must be after the actual TypeScript calculation");
          crossed = true;
          assertEquals((await route(id, "freeze", "POST", { frozen: !initialFrozen }))?.status, 200);
        }
        return await originalFetch(input, init);
      };
      const accepted = await acceptCycle(cycle, WS, "Fictional Person");
      assert(crossed, "the actual acceptance RPC barrier was not reached");
      assert(accepted);
      const snapshot = (await listItems(cycle, WS, "everyone"))[0];
      assertEquals(snapshot.task_frozen, !initialFrozen);
      const stats = accepted.cycle.stats as { plan: number };
      assertEquals(stats.plan, snapshot.task_frozen ? 0 : 1, "FrozenAcceptanceSnapshotStatsMismatch");
    } finally {
      globalThis.fetch = originalFetch;
      await db.end();
    }
  });
}
