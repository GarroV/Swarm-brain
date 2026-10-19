// Ключи доступа на НАСТОЯЩЕЙ базе (#955): уборка `public.passkeys_prune()` и замок на таблицах.
//
// Доказывается: ключ без входа 30 дней снимается (по last_used_at, у неиспользованного — по
// created_at), свежий и недавно использованный остаются; старые вызовы убираются; удаление человека
// уносит его ключи; вызвать уборку и прочитать таблицы может только service_role. Строки заводятся
// внутри транзакции и откатываются. Тест не умеет «пропускаться»: базы нет — прогон падает.
// Не прогонялся на Маке (Docker там не поднимаем) — его гоняет CI на черновом PR.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PERSON = 800000931;

async function scenario(run: (db: Client) => Promise<void>): Promise<void> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(`нет базы ${DB_URL} — подними контур (make test-db): ${(e as Error).message}`);
  }
  try {
    await db.queryArray("begin");
    await db.queryArray(`insert into public.allowed_users (telegram_id, added_by) values (${PERSON}, 1)`);
    await run(db);
  } finally {
    await db.queryArray("rollback").catch(() => {});
    await db.end();
  }
}

const key = (id: string, created: string, used: string | null) =>
  `insert into public.passkeys (telegram_id, credential_id, public_key, name, created_at, last_used_at)
   values (${PERSON}, '${id}', 'pk', 'Chrome · Mac', now() - interval '${created}', ${
    used ? `now() - interval '${used}'` : "null"
  })`;

Deno.test("passkeys_prune: снимает ключи без входа 30 дней, остальное оставляет", async () => {
  await scenario(async (db) => {
    await db.queryArray(key("old-unused", "31 days", null)); // не входили ни разу, 31 день
    await db.queryArray(key("old-idle", "90 days", "31 days")); // входили, но давно
    await db.queryArray(key("fresh-unused", "29 days", null));
    await db.queryArray(key("recent", "90 days", "2 days"));
    await db.queryArray(
      `insert into public.passkey_challenges (telegram_id, purpose, challenge, expires_at)
       values (${PERSON}, 'register', 'old', now() - interval '3 hours'), (${PERSON}, 'register', 'live', now() + interval '1 minute')`,
    );
    const removed = await db.queryObject<{ n: number }>("select public.passkeys_prune() as n");
    assertEquals(removed.rows[0].n, 2);
    const left = await db.queryObject<{ credential_id: string }>(
      `select credential_id from public.passkeys where telegram_id = ${PERSON} order by 1`,
    );
    assertEquals(left.rows.map((r) => r.credential_id), ["fresh-unused", "recent"]);
    const ch = await db.queryObject<{ challenge: string }>(
      `select challenge from public.passkey_challenges where telegram_id = ${PERSON}`,
    );
    assertEquals(ch.rows.map((r) => r.challenge), ["live"]);
  });
});

Deno.test("удаление человека из allowed_users уносит его ключи и вызовы", async () => {
  await scenario(async (db) => {
    await db.queryArray(key("k", "1 day", null));
    await db.queryArray(
      `insert into public.passkey_challenges (telegram_id, purpose, challenge, expires_at)
       values (${PERSON}, 'register', 'c', now() + interval '1 minute')`,
    );
    await db.queryArray(`delete from public.allowed_users where telegram_id = ${PERSON}`);
    const left = await db.queryObject<{ n: number }>(
      `select (select count(*) from public.passkeys where telegram_id = ${PERSON})::int
            + (select count(*) from public.passkey_challenges where telegram_id = ${PERSON})::int as n`,
    );
    assertEquals(left.rows[0].n, 0);
  });
});

Deno.test("замок: anon не читает таблицы и не зовёт уборку, service_role — может", async () => {
  await scenario(async (db) => {
    const priv = (role: string, what: string) =>
      db.queryObject<{ ok: boolean }>(`select has_${what} as ok`.replace("${role}", role));
    for (const t of ["passkeys", "passkey_challenges"]) {
      for (const role of ["anon", "authenticated", "public"]) {
        const r = await priv(role, `table_privilege('${role}', 'public.${t}', 'select')`);
        assertEquals(r.rows[0].ok, false, `${role} читает ${t}`);
      }
    }
    for (const role of ["anon", "authenticated"]) {
      const r = await priv(role, `function_privilege('${role}', 'public.passkeys_prune()', 'execute')`);
      assertEquals(r.rows[0].ok, false, `${role} зовёт passkeys_prune`);
    }
    assertEquals(
      (await priv("service_role", "function_privilege('service_role', 'public.passkeys_prune()', 'execute')")).rows[0]
        .ok,
      true,
    );
  });
});
