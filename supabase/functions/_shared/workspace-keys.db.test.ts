// Замок на таблицах ключей пространств и мастер-админов (#233) — на НАСТОЯЩЕЙ базе после всех
// миграций: anon/authenticated/PUBLIC не читают и не пишут, service_role работает, владелец засеян.
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TABLES = ["workspace_secrets", "master_admins", "ai_key_health"];
const FORBIDDEN_ROLES = ["anon", "authenticated"];
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(`нет базы ${DB_URL} — подними контур (make test-db): ${(e as Error).message}`);
  }
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

Deno.test("ключи пространств: anon и authenticated не имеют прав на таблицы", async () => {
  await withDb(async (db) => {
    const granted: string[] = [];
    for (const table of TABLES) {
      for (const role of FORBIDDEN_ROLES) {
        for (const priv of PRIVILEGES) {
          const res = await db.queryObject<{ ok: boolean }>(
            `select has_table_privilege($1, $2, $3) as ok`,
            [role, `public.${table}`, priv],
          );
          if (res.rows[0].ok) granted.push(`${role} ${priv} ${table}`);
        }
      }
    }
    assertEquals(granted, [], `грант просочился (в том числе через PUBLIC): ${granted.join("; ")}`);
  });
});

Deno.test("ключи пространств: service_role читает и пишет, RLS включён", async () => {
  await withDb(async (db) => {
    for (const table of TABLES) {
      for (const priv of PRIVILEGES) {
        const res = await db.queryObject<{ ok: boolean }>(
          `select has_table_privilege('service_role', $1, $2) as ok`,
          [`public.${table}`, priv],
        );
        assertEquals(res.rows[0].ok, true, `service_role без ${priv} на ${table}`);
      }
      const rls = await db.queryObject<{ on: boolean }>(
        `select relrowsecurity as on from pg_class where oid = $1::regclass`,
        [`public.${table}`],
      );
      assertEquals(rls.rows[0].on, true, `${table}: RLS выключен`);
    }
  });
});

Deno.test("master_admins: владелец засеян", async () => {
  await withDb(async (db) => {
    const res = await db.queryObject<{ n: bigint }>(
      `select count(*) as n from public.master_admins where telegram_id = 744230399`,
    );
    assertEquals(Number(res.rows[0].n), 1);
  });
});
