import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Client } from "postgres";
import { SUPERADMIN_TELEGRAM_ID as OWNER } from "./admin-scope.ts";

const url = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FIRST = 990_102_101;
const SECOND = 990_102_102;
const FAILED = 990_102_103;

Deno.test("master admin journal: atomic role changes, denied/no-op cases and append-only storage", async () => {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "isolated loopback database required");
  const db = new Client(url);
  await db.connect();
  try {
    await db.queryArray("begin");
    await db.queryArray("select pg_advisory_xact_lock(hashtext('master-admin-history-test'))");
    await db.queryArray`delete from public.master_admins where telegram_id=any(${[FIRST, SECOND, FAILED]})`;
    const change = async (target: number, action: string) => {
      // Exercise the actual invoker role, not postgres's ownership bypass. Each failed
      // statement must restore the transaction/role without masking its original error.
      await db.queryArray("savepoint role_call");
      try {
        await db.queryArray("set local role service_role");
        const result = (await db.queryObject<{ result: { ok: boolean; changed?: boolean; reason?: string } }>`
          select public.change_master_admin_role(${target}, ${OWNER}, ${action}, ${OWNER}) as result
        `).rows[0].result;
        await db.queryArray("reset role");
        await db.queryArray("release savepoint role_call");
        return result;
      } catch (error) {
        await db.queryArray("rollback to savepoint role_call");
        await db.queryArray("release savepoint role_call");
        throw error;
      }
    };
    assertEquals(await change(FIRST, "added"), { ok: true, changed: true });
    assertEquals(await change(SECOND, "added"), { ok: true, changed: true });
    assertEquals(await change(FIRST, "removed"), { ok: true, changed: true });
    assertEquals(await change(SECOND, "added"), { ok: true, changed: false });
    const events = async () =>
      (await db.queryObject<{ action: string; actor: number; target: number; valid_time: boolean }>`
        select action, actor_telegram_id::int as actor, target_telegram_id::int as target,
               created_at is not null as valid_time
          from public.master_admin_events where target_telegram_id=any(${[FIRST, SECOND, FAILED]})
         order by created_at, id
      `).rows;
    assertEquals(await events(), [
      { action: "added", actor: OWNER, target: FIRST, valid_time: true },
      { action: "added", actor: OWNER, target: SECOND, valid_time: true },
      { action: "removed", actor: OWNER, target: FIRST, valid_time: true },
    ]);
    assertEquals(await change(OWNER, "removed"), { ok: false, reason: "builtin" });
    assertEquals(await change(FAILED, "removed"), { ok: false, reason: "not_found" });
    assertEquals(await change(-1, "added"), { ok: false, reason: "invalid_id" });
    assertEquals((await events()).length, 3);

    await db.queryArray("savepoint missing_journal");
    await db.queryArray(
      "alter table public.master_admin_events add constraint qa_master_admin_journal_failure check(false) not valid",
    );
    await assertRejects(() => change(FAILED, "added"), Error, "qa_master_admin_journal_failure");
    await db.queryArray("rollback to missing_journal");
    assertEquals(
      (await db.queryObject`select telegram_id from public.master_admins where telegram_id=${FAILED}`).rows,
      [],
    );
    assertEquals((await events()).length, 3);

    await db.queryArray("savepoint last_master");
    await db.queryArray`delete from public.master_admins where telegram_id<>${SECOND}`;
    assertEquals(await change(SECOND, "removed"), { ok: false, reason: "last" });
    assertEquals((await events()).length, 3);
    await db.queryArray("rollback to last_master");

    const privileges = await db.queryObject<
      { role: string; read: boolean; insert: boolean; update: boolean; remove: boolean }
    >(`
      select r as role,
        has_table_privilege(r,'public.master_admin_events','SELECT') as read,
        has_table_privilege(r,'public.master_admin_events','INSERT') as insert,
        has_table_privilege(r,'public.master_admin_events','UPDATE') as update,
        has_table_privilege(r,'public.master_admin_events','DELETE') as remove
      from unnest(array['anon','authenticated','service_role']) r order by r
    `);
    assertEquals(privileges.rows, [
      { role: "anon", read: false, insert: false, update: false, remove: false },
      { role: "authenticated", read: false, insert: false, update: false, remove: false },
      { role: "service_role", read: true, insert: true, update: false, remove: false },
    ]);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});
