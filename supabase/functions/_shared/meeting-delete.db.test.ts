import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";
import { createClient } from "@supabase/supabase-js";
import { deleteDraftMeeting } from "./meeting-delete.ts";
import { purgeBackupRow } from "./meeting-backup-retention.ts";

function environment() {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL"),
    api = Deno.env.get("SUPABASE_URL"),
    key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!dbUrl || !api || !key) throw new Error("isolated_test_environment_required");
  const local = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!local.has(new URL(dbUrl).hostname) || !local.has(new URL(api).hostname)) throw new Error("loopback_test_only");
  return { dbUrl, api, key };
}

Deno.test("draft delete DB: real invoker CAS, atomic rollback, backup compatibility and job privileges", async () => {
  const { dbUrl } = environment();
  const db = new Client(dbUrl);
  await db.connect();
  const id = crypto.randomUUID(), backup = crypto.randomUUID();
  try {
    await db.queryArray("begin");
    await db.queryArray`insert into public.meetings(id,source,identity_kind,identity_key,group_id,recorders)
      values(${id},'desktop-agent','manual',${id},'demo','[{"telegram_id":1168}]')`;
    await db.queryArray`insert into public.meeting_audio_backups(id,meeting_id,uploader,source,reason,parts)
      values(${backup},${id},1168,'person:1168','rejected','[]')`;
    const backupBefore =
      (await db.queryArray`select to_jsonb(b) from public.meeting_audio_backups b where id=${backup}`).rows;
    // Recreate the exact historical FK to demonstrate why legacy physical deletion fails.
    await db.queryArray("savepoint historical_fk");
    await db.queryArray(
      "alter table public.meeting_audio_backups add constraint meeting_audio_backups_meeting_id_fkey foreign key(meeting_id) references public.meetings(id)",
    );
    await db.queryArray("savepoint failed_delete");
    let fkCode = "";
    try {
      await db.queryArray`delete from public.meetings where id=${id}`;
    } catch (error) {
      fkCode = (error as { fields?: { code?: string } }).fields?.code ?? "";
    }
    assertEquals(fkCode, "23503");
    await db.queryArray("rollback to savepoint historical_fk");
    await db.queryArray("release savepoint historical_fk");
    const asService = async <T>(query: () => Promise<T>): Promise<T> => {
      await db.queryArray("savepoint service_call");
      try {
        await db.queryArray("set local role service_role");
        const result = await query();
        await db.queryArray("reset role");
        await db.queryArray("release savepoint service_call");
        return result;
      } catch (error) {
        await db.queryArray("rollback to savepoint service_call");
        await db.queryArray("release savepoint service_call");
        throw error;
      }
    };
    const snapshot = async () =>
      (await asService(() =>
        db.queryObject<{ value: { version: string } }>`
      select public.draft_meeting_delete_snapshot(${id}::uuid) as value`
      )).rows[0].value;
    const start = async (version: string, group = "demo") =>
      (await asService(() =>
        db.queryObject<{ value: boolean }>`
      select public.start_draft_meeting_delete(${id}::uuid,${version},${group},1168,'demo') as value`
      )).rows[0].value;
    const stale = await snapshot();
    await db.queryArray`update public.meetings set title='Fictional changed draft' where id=${id}`;
    assertEquals(await start(stale.version), false);
    // Exercise the owned CAS regression against the real function, then restore it.
    await db.queryArray("savepoint cas_mutant");
    const original = (await db.queryObject<{ body: string }>`select pg_get_functiondef(
      'public.start_draft_meeting_delete(uuid,text,text,bigint,text)'::regprocedure) as body`).rows[0].body;
    const mutated = original.replace("m.xmin::text || ':' || m.ctid::text = p_version", "true");
    assert(mutated !== original, "cas_mutation_must_apply");
    await db.queryArray(mutated);
    assertEquals(await start(stale.version), true, "owned_mutant_must_expose_stale_delete");
    await db.queryArray("rollback to savepoint cas_mutant");
    await db.queryArray("release savepoint cas_mutant");
    assertEquals(await start(stale.version), false, "restored_cas_rejects_stale_delete");
    const current = await snapshot();
    assertEquals(await start(current.version, "wrong-scope"), false);
    await db.queryArray`update public.meetings set status='in_base' where id=${id}`;
    assertEquals(await start((await snapshot()).version), false);
    await db.queryArray`update public.meetings set status='awaiting_review' where id=${id}`;
    // Job insertion failure must leave the meeting intact (no partial DB commit).
    await db.queryArray("savepoint failed_job");
    await db.queryArray(
      `create function pg_temp.fail_draft_job() returns trigger language plpgsql as $$begin raise exception 'fixture_job_failure'; end$$`,
    );
    await db.queryArray(
      "create trigger fixture_fail_job before insert on public.draft_meeting_deletions for each row execute function pg_temp.fail_draft_job()",
    );
    let failureCode = "";
    try {
      await start((await snapshot()).version);
    } catch (error) {
      failureCode = (error as { fields?: { code?: string } }).fields?.code ?? "";
    }
    assertEquals(failureCode, "P0001");
    assertEquals((await db.queryArray`select id from public.meetings where id=${id}`).rows.length, 1);
    await db.queryArray("rollback to savepoint failed_job");
    await db.queryArray("release savepoint failed_job");
    assertEquals(await start((await snapshot()).version), true);
    assertEquals((await db.queryArray`select id from public.meetings where id=${id}`).rows.length, 0);
    assertEquals(
      (await db.queryArray`select to_jsonb(b) from public.meeting_audio_backups b where id=${backup}`).rows,
      backupBefore,
    );
    const privileges = await db.queryArray<[boolean, boolean, boolean, boolean, boolean]>(`select
      has_table_privilege('service_role','public.draft_meeting_deletions','select'),
      has_table_privilege('service_role','public.draft_meeting_deletions','insert'),
      has_table_privilege('service_role','public.draft_meeting_deletions','update'),
      has_table_privilege('service_role','public.draft_meeting_deletions','delete'),
      has_table_privilege('service_role','public.draft_meeting_deletions','truncate')`);
    assertEquals(privileges.rows[0], [true, true, true, false, false]);
  } finally {
    await db.queryArray("rollback").catch(() => undefined);
    await db.end();
  }
});

Deno.test("draft delete runtime: actual SQL/Storage, failed cleanup retry, immutable backup then existing purge", async () => {
  const { dbUrl, api, key } = environment();
  const db = new Client(dbUrl);
  await db.connect();
  let failRemove = true, blockDelete = false;
  const sb = createClient(api, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch(input, init) {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
        if (
          url.origin !== new URL(api).origin || !["/rest/v1/", "/storage/v1/"].some((p) => url.pathname.startsWith(p))
        ) {
          throw new Error("isolated_test_transport_only");
        }
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (blockDelete && failRemove && method === "DELETE" && url.pathname.startsWith("/storage/v1/object/")) {
          return Promise.resolve(new Response(JSON.stringify({ message: "fixture_storage_failure" }), { status: 503 }));
        }
        return fetch(input, init);
      },
    },
  });
  const id = crypto.randomUUID(), foreign = crypto.randomUUID(), backup = crypto.randomUUID();
  const paths = [
    `${id}/generation/part.bin`,
    `${id}/queued/source.json`,
    `${foreign}/part.bin`,
    `backup/${id}/part.bin`,
  ];
  try {
    await db.queryArray(
      "insert into storage.buckets(id,name,public) values('meeting-audio','meeting-audio',false) on conflict(id) do nothing",
    );
    await db.queryArray`insert into public.meetings(id,source,identity_kind,identity_key,group_id,recorders)
      values(${id},'desktop-agent','manual',${id},'demo','[{"telegram_id":1168}]')`;
    for (const path of paths) {
      const r = await sb.storage.from("meeting-audio").upload(path, new Uint8Array([1, 2, 3]));
      assert(!r.error, "synthetic_upload_failed");
    }
    await db.queryArray`insert into public.meeting_audio_backups(id,meeting_id,uploader,source,reason,parts)
      values(${backup},${id},1168,'person:1168','rejected',${JSON.stringify([{ path: paths[3] }])}::jsonb)`;
    const before =
      (await db.queryArray`select to_jsonb(b) from public.meeting_audio_backups b where id=${backup}`).rows;
    blockDelete = true;
    const actor = { telegramId: 1168, groupId: "demo", isAdmin: false };
    assertEquals(await deleteDraftMeeting(sb, id, actor), { ok: false, reason: "storage" });
    assertEquals((await db.queryArray`select id from public.meetings where id=${id}`).rows.length, 0);
    assertEquals(
      (await db.queryArray`select completed_at from public.draft_meeting_deletions where meeting_id=${id}`).rows,
      [[null]],
    );
    failRemove = false;
    assertEquals(await deleteDraftMeeting(sb, id, actor), { ok: true });
    assertEquals(await deleteDraftMeeting(sb, id, actor), { ok: true });
    assertEquals(
      (await db.queryArray`select name from storage.objects where bucket_id='meeting-audio' and name like ${id + "/%"}`)
        .rows,
      [],
    );
    assertEquals(
      (await db.queryArray`select to_jsonb(b) from public.meeting_audio_backups b where id=${backup}`).rows,
      before,
    );
    assertEquals(
      (await db.queryArray`select name from storage.objects where bucket_id='meeting-audio' and name=any(${
        paths.slice(2)
      })`).rows.length,
      2,
    );
    // Existing cleaner works from the backup row alone after its parent has gone.
    assertEquals(await purgeBackupRow(sb, { id: backup, parts: [{ path: paths[3] }] }), true);
    assertEquals(
      (await db.queryArray`select name from storage.objects where bucket_id='meeting-audio' and name=${paths[3]}`).rows
        .length,
      0,
    );
    assertEquals(
      (await db.queryArray`select name from storage.objects where bucket_id='meeting-audio' and name=${paths[2]}`).rows
        .length,
      1,
    );
  } finally {
    blockDelete = false;
    await sb.storage.from("meeting-audio").remove(paths);
    await db.queryArray`delete from public.meeting_audio_backups where id=${backup}`;
    await db.queryArray`delete from public.meetings where id=${id}`;
    await db.queryArray`delete from public.draft_meeting_deletions where meeting_id=${id}`;
    await db.end();
  }
});
