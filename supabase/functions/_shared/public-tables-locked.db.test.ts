// Внешний замок на таблицах `public` (правило #41, issue #671) — на НАСТОЯЩЕЙ базе после всех
// миграций (в CI контур поднимается с нуля).
//
// Клиент в базу напрямую не ходит: всё — через Edge Functions под service_role. Поэтому у каждой
// таблицы `public` включён RLS — без политик это deny-all для anon/authenticated, и именно он, а
// не гранты, держит замок: права Supabase по умолчанию выдают anon гранты на новые таблицы (на
// проде 02.10.2026 — 28 из 34). До этого теста правило держалось на памяти автора миграции, и
// пять таблиц читались анонимно (#41).
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function rows(sql: string): Promise<string[]> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(`нет базы ${DB_URL} — подними контур (make test-db): ${(e as Error).message}`);
  }
  try {
    const res = await db.queryObject<{ name: string }>(sql);
    return res.rows.map((r) => r.name);
  } finally {
    await db.end();
  }
}

type TableQuery = (sql: string) => Promise<string[]>;

// The optional query keeps regression DDL and catalog reads on one rolled-back connection.
export async function assertPublicTableContracts(query: TableQuery = rows): Promise<void> {
  const open = await query(`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`);
  assertEquals(open, [], `таблицы public без RLS — включи тем же файлом миграции: ${open.join(", ")}`);
}

Deno.test("public: у каждой таблицы включён RLS", () => assertPublicTableContracts());

async function inTransaction(fn: (db: Client, table: string) => Promise<void>) {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await db.queryArray`begin`;
    const role = await db.queryObject<{ name: string }>`select current_user as name`;
    assertEquals(role.rows[0].name, "postgres", "default privileges проверяются для создателя postgres");
    await fn(db, `qa_grants_880_${crypto.randomUUID().replaceAll("-", "")}`);
  } finally {
    await db.queryArray`rollback`;
    await db.end();
  }
}

async function asService<T>(db: Client, fn: () => Promise<T>): Promise<T> {
  await db.queryArray`savepoint service_grants_probe_880`;
  try {
    await db.queryArray`set local role service_role`;
    const result = await fn();
    await db.queryArray`reset role`;
    await db.queryArray`release savepoint service_grants_probe_880`;
    return result;
  } catch (error) {
    await db.queryArray`rollback to savepoint service_grants_probe_880`;
    await db.queryArray`release savepoint service_grants_probe_880`;
    throw error;
  }
}

Deno.test("public: новые таблицы требуют явных DML-grants service_role", async () => {
  await inTransaction(async (db, table) => {
    await db.queryArray(`create table public.${table} (id integer)`);
    await db.queryArray(`alter table public.${table} enable row level security`);
    const permissions = await db.queryObject<{ privilege: string; allowed: boolean }>(`
      select privilege, has_table_privilege('service_role', 'public.${table}', privilege) as allowed
      from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as privilege`);
    assertEquals(permissions.rows.map((p) => p.allowed), [false, false, false, false]);
    const error = await assertRejects(() => asService(db, () => db.queryArray(`select * from public.${table}`)));
    assertEquals((error as { fields?: { code?: string } }).fields?.code, "42501");
    const restored = await db.queryObject<{ name: string }>`select current_user as name`;
    assertEquals(restored.rows[0].name, "postgres", "ошибка RPC не должна оставлять роль или aborted transaction");
  });
});

Deno.test("public: сторож замечает потерю DML-grants при включённом RLS", async () => {
  await inTransaction(async (db, table) => {
    const template = (await Deno.readTextFile(new URL("../../migrations/_template_new_table.sql", import.meta.url)))
      .replaceAll("public.your_table", `public.${table}`);
    // The checked-in template is two plain statements; execute its actual SQL, not a mirror.
    for (const statement of template.split(";").filter((s) => s.trim())) await db.queryArray(statement);
    await db.queryArray(`alter table public.${table} enable row level security`);
    await asService(db, async () => {
      const inserted = await db.queryObject<{ id: string }>(`insert into public.${table} default values returning id`);
      const id = inserted.rows[0].id;
      assertEquals((await db.queryObject(`select id from public.${table} where id = $1`, [id])).rows.length, 1);
      assertEquals(
        (await db.queryObject(`update public.${table} set created_at = created_at where id = $1 returning id`, [id]))
          .rows.length,
        1,
      );
      assertEquals(
        (await db.queryObject(`delete from public.${table} where id = $1 returning id`, [id])).rows.length,
        1,
      );
    });
    const query: TableQuery = async (sql) => (await db.queryObject<{ name: string }>(sql)).rows.map((r) => r.name);
    await assertPublicTableContracts(query);
    await db.queryArray(`revoke select, insert, update, delete on public.${table} from service_role`);
    const missing = await db.queryObject<{ allowed: boolean }>(`
      select has_table_privilege('service_role', 'public.${table}', privilege) as allowed
      from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as privilege`);
    assertEquals(missing.rows.map((p) => p.allowed), [false, false, false, false]);
    const error = await assertRejects(() => assertPublicTableContracts(query), Error);
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assertStringIncludes(error.message, `${table}:${privilege}`);
    }
  });
});
