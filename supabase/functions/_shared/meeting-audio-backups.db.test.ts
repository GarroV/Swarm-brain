// Таблица серверных бэкапов записей (#1070, решение 27.10.2026) на НАСТОЯЩЕЙ базе: внешний замок
// (anon/authenticated ничего не читают), срок хранения по умолчанию три дня, один живой бэкап на
// (встреча, источник) и допустимые причины. Всё внутри транзакции с откатом.
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MEETING = "7e57a0d0-0000-4000-8000-0000000b4c01";
const TABLE = "public.meeting_audio_backups";

async function scenario(run: (db: Client) => Promise<void>): Promise<void> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с тестовой базой (${DB_URL}). Запускай через ./scripts/with-local-db. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  try {
    await db.queryArray("begin");
    await db.queryArray(
      `insert into public.meetings (id, source, identity_kind, identity_key)
       values ('${MEETING}', 'desktop-agent', 'manual', '${MEETING}')`,
    );
    await run(db);
  } finally {
    await db.queryArray("rollback").catch(() => undefined);
    await db.end();
  }
}

const insert = (db: Client, source: string, reason = "rejected") =>
  db.queryArray(
    `insert into ${TABLE} (meeting_id, uploader, source, reason, parts)
     values ('${MEETING}', 1, $1, $2, '[]'::jsonb)`,
    [source, reason],
  );

Deno.test("бэкапы: anon/authenticated не читают и не пишут, service_role работает, RLS включён", async () => {
  await scenario(async (db) => {
    const r = await db.queryArray<[boolean, boolean, boolean, boolean, boolean, boolean]>(
      `select has_table_privilege('anon', '${TABLE}', 'select'),
              has_table_privilege('authenticated', '${TABLE}', 'select'),
              has_table_privilege('anon', '${TABLE}', 'insert'),
              has_table_privilege('authenticated', '${TABLE}', 'update'),
              has_table_privilege('service_role', '${TABLE}', 'select'),
              has_table_privilege('service_role', '${TABLE}', 'insert')`,
    );
    assertEquals(r.rows[0], [false, false, false, false, true, true]);
    const rls = await db.queryArray<[boolean]>(
      `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`,
    );
    assertEquals(rls.rows[0][0], true);
  });
});

Deno.test("бэкапы: срок хранения по умолчанию — три дня от создания", async () => {
  await scenario(async (db) => {
    await insert(db, "person:1");
    const r = await db.queryArray<[number]>(
      `select extract(epoch from (expires_at - created_at))::int from ${TABLE} where meeting_id = '${MEETING}'`,
    );
    assertEquals(r.rows[0][0], 3 * 24 * 3600);
  });
});

Deno.test("бэкапы: один живой бэкап на (встреча, источник); заменённый или убранный место освобождает", async () => {
  await scenario(async (db) => {
    await insert(db, "person:1");
    await insert(db, "person:2"); // другой источник той же встречи — можно
    await db.queryArray("savepoint dup");
    await assertRejects(() => insert(db, "person:1"), Error, "meeting_audio_backups_active_uq");
    await db.queryArray("rollback to savepoint dup");
    await db.queryArray(`update ${TABLE} set replaced_at = now() where source = 'person:1'`);
    await insert(db, "person:1");
    await db.queryArray(`update ${TABLE} set purged_at = now() where source = 'person:2'`);
    await insert(db, "person:2");
    const n = await db.queryArray<[number]>(
      `select count(*)::int from ${TABLE} where meeting_id = '${MEETING}' and purged_at is null and replaced_at is null`,
    );
    assertEquals(n.rows[0][0], 2);
  });
});

Deno.test("бэкапы: неизвестная причина отбивается базой", async () => {
  await scenario(async (db) => {
    await db.queryArray("savepoint bad_reason");
    await assertRejects(() => insert(db, "person:1", "whatever"), Error, "check");
    await db.queryArray("rollback to savepoint bad_reason");
    await insert(db, "person:1", "deferred");
    const n = await db.queryArray<[number]>(`select count(*)::int from ${TABLE} where meeting_id = '${MEETING}'`);
    assertEquals(n.rows[0][0], 1);
  });
});
