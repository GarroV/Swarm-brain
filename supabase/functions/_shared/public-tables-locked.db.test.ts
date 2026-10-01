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
import { assertEquals } from "@std/assert";
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

Deno.test("public: у каждой таблицы включён RLS", async () => {
  const open = await rows(`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`);
  assertEquals(open, [], `таблицы public без RLS — включи тем же файлом миграции: ${open.join(", ")}`);
});
