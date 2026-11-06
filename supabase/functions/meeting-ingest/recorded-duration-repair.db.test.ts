// One-off repair: real isolated Postgres, canonical media duration, no prod connection or messages.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Client } from "postgres";
import { measureUpload } from "./challenge-io.ts";
import { m4aOf } from "./m4a-fixture.ts";
import type { InMemoryPart } from "../_shared/meeting-processor.ts";

const SQL = new URL("../../maintenance/recorded-duration-repair.sql", import.meta.url);
const SNAPSHOT = "md5((to_jsonb(m) - 'recorded_seconds')::text) IS DISTINCT FROM p.row_hash";
type Plan = { meeting_id: string; row_hash: string; audio_hash: string; measured_seconds: number };

async function fixture(run: (db: Client, ids: string[], plan: Plan[]) => Promise<void>) {
  const db = new Client(Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await db.connect();
  try {
    await db.queryArray("begin");
    await db.queryArray("set local timezone to 'UTC'");
    let sql = await Deno.readTextFile(SQL);
    if (Deno.env.get("DURATION_REPAIR_MUTANT") === "1") {
      assertEquals(sql.split(SNAPSHOT).length - 1, 2);
      sql = sql.replaceAll(SNAPSHOT, "false");
    }
    await db.queryArray(sql);
    const workspace = `t-duration-repair-${crypto.randomUUID()}`;
    const owner = -Math.floor(Math.random() * 1e12) - 1;
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    await db.queryArray("insert into workspaces(id,name) values($1,'duration fixture')", [workspace]);
    await db.queryArray("insert into allowed_users(telegram_id,added_by,group_id) values($1,0,$2)", [owner, workspace]);
    await db.queryArray(
      "insert into storage.buckets(id,name,public) values('meeting-audio','meeting-audio',false) on conflict do nothing",
    );
    const media = [
      { offset: 0, blob: new Blob([m4aOf(3)]) },
      { offset: 5, blob: new Blob([m4aOf(2)]) },
      { offset: 0, blob: new Blob([m4aOf(3)]) },
    ];
    const measured = await measureUpload(media as InMemoryPart[]);
    assertEquals(measured, 5, "canonical union: neither gaps nor duplicate tracks inflate seconds");
    for (const id of ids) {
      const parts = [];
      for (let index = 0; index < media.length; index++) {
        const path = `${id}/fixture/p${index}.m4a`;
        await db.queryArray(
          "insert into storage.objects(bucket_id,name,metadata) values('meeting-audio',$1,$2::jsonb)",
          [path, JSON.stringify({ size: media[index].blob.size })],
        );
        parts.push({ path, offset: media[index].offset, track: index === 2 ? "mic" : "sys", done: true });
      }
      const state = { owner, gen: crypto.randomUUID(), parts };
      await db.queryArray(
        `insert into meetings(id,source,identity_kind,identity_key,group_id,claim_owner,summary_status,recorded_seconds,process_state)
         values($1::uuid,'desktop-agent','manual',$1::text,$2,$3,'done',null,$4::jsonb)`,
        [id, workspace, owner, JSON.stringify(state)],
      );
    }
    const rows = await db.queryObject<Omit<Plan, "measured_seconds">>(
      `select m.id as meeting_id, md5((to_jsonb(m)-'recorded_seconds')::text) as row_hash,
       pg_temp.recorded_duration_audio_hash(m.process_state) as audio_hash from meetings m where id=any($1::uuid[]) order by id`,
      [ids],
    );
    await run(db, ids, rows.rows.map((r) => ({ ...r, measured_seconds: measured! })));
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
}

async function apply(db: Client, plan: Plan[]) {
  return (await db.queryObject<{ changed: number }>("select pg_temp.repair_recorded_durations($1::jsonb) as changed", [
    JSON.stringify(plan),
  ])).rows[0].changed;
}
async function rejected(db: Client, plan: Plan[]) {
  await db.queryArray("savepoint before_apply");
  let failed = false;
  try {
    await apply(db, plan);
  } catch {
    failed = true;
  }
  await db.queryArray("rollback to savepoint before_apply");
  assert(failed, "stale/unsafe repair must fail and roll back");
}
async function missing(db: Client, ids: string[]) {
  return (await db.queryObject<{ n: number }>(
    "select count(*)::int n from meetings where id=any($1::uuid[]) and recorded_seconds is null",
    [ids],
  )).rows[0].n;
}

Deno.test("duration repair: four exact snapshots change only NULL seconds", async () => {
  await fixture(async (db, ids, plan) => {
    assertEquals(await apply(db, plan), 4);
    assertEquals(await missing(db, ids), 0);
    const rows = await db.queryObject<{ seconds: string; hash: string }>(
      "select recorded_seconds::text seconds,md5((to_jsonb(m)-'recorded_seconds')::text) hash from meetings m where id=any($1::uuid[]) order by id",
      [ids],
    );
    assertEquals(rows.rows.map((r) => r.seconds), ["5", "5", "5", "5"]);
    assertEquals(rows.rows.map((r) => r.hash), plan.map((p) => p.row_hash));
    await rejected(db, plan); // Already repaired rows cannot be overwritten.
  });
});

Deno.test("duration repair: stale status rolls back all four", async () => {
  await fixture(async (db, ids, plan) => {
    await db.queryArray("update meetings set status='in_base' where id=$1", [ids[3]]);
    await rejected(db, plan);
    assertEquals(await missing(db, ids), 4);
  });
});

Deno.test("duration repair: changed ownership/source/audio state or object version rejects the batch", async () => {
  for (
    const mutation of [
      "update meetings set claim_owner=null where id=$1",
      "update meetings set source='fixture-other' where id=$1",
      "update meetings set summary_status='failed' where id=$1",
      "update meetings set process_state=jsonb_set(process_state,'{gen}','\"changed\"') where id=$1",
      "update storage.objects set version='changed' where name=(select process_state->'parts'->0->>'path' from meetings where id=$1)",
    ]
  ) {
    await fixture(async (db, ids, plan) => {
      await db.queryArray(mutation, [ids[3]]);
      await rejected(db, plan);
      assertEquals(await missing(db, ids), 4);
    });
  }
});

Deno.test("duration repair: trigger that could send a side effect is blocked without disabling it", async () => {
  await fixture(async (db, ids, plan) => {
    await db.queryArray("create temp table duration_effects(n int); insert into duration_effects values(0)");
    await db.queryArray(
      `create function pg_temp.duration_effect() returns trigger language plpgsql as $$begin update duration_effects set n=n+1; return new; end$$`,
    );
    await db.queryArray(
      "create trigger duration_effect after update of recorded_seconds on meetings for each row execute function pg_temp.duration_effect()",
    );
    await rejected(db, plan);
    assertEquals(await missing(db, ids), 4);
    assertEquals((await db.queryObject<{ n: number }>("select n from duration_effects")).rows[0].n, 0);
  });
});

Deno.test("duration repair: RED check rejects removal of snapshot CAS", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      "-A",
      "--filter",
      "duration repair: stale status rolls back all four",
      new URL(import.meta.url).pathname,
    ],
    env: { DURATION_REPAIR_MUTANT: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(!result.success, "the deliberately unsafe copy must fail on changed status");
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  assert(output.includes("FAILED"));
  assert(
    output.includes("stale/unsafe repair must fail and roll back"),
    "RED must come from the missing CAS, not a broken fixture",
  );
  console.log("RED: removing snapshot CAS fails the real Postgres regression; canonical guarded path passes GREEN");
});
