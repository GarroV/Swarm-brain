// Ссылки «Добавить устройство» на НАСТОЯЩЕЙ базе (решение 17.10.2026): функции
// passkey_device_link_{issue,arm,consume} и замок на таблице.
//
// Доказывается: ссылка гасится один раз; чужой человек, просроченная ссылка и невзведённый вызов не
// проходят; новая ссылка гасит прежнюю; лимит выдачи держится; anon/authenticated не зовут функции и
// не читают таблицу. Строки заводятся внутри транзакции и откатываются. Тест не умеет «пропускаться»:
// базы нет — прогон падает. Источник истины — CI (чистая база на каждый прогон).
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ANNA = 800000941;
const BORIS = 800000942;

async function scenario(run: (db: Client) => Promise<void>): Promise<void> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(`нет базы ${DB_URL} — подними контур (make test-db): ${(e as Error).message}`);
  }
  try {
    await db.queryArray("begin");
    await db.queryArray(
      `insert into public.allowed_users (telegram_id, added_by) values (${ANNA}, 1), (${BORIS}, 1)`,
    );
    await run(db);
  } finally {
    await db.queryArray("rollback").catch(() => {});
    await db.end();
  }
}

const issue = async (db: Client, who: number, hash: string, max = 5) =>
  (await db.queryObject<{ ok: boolean }>(
    `select public.passkey_device_link_issue(${who}, '${hash}', 600, ${max}, 3600) as ok`,
  )).rows[0].ok;
const arm = async (db: Client, who: number, hash: string, ch = "ch-1") =>
  (await db.queryObject<{ ok: boolean }>(
    `select public.passkey_device_link_arm(${who}, '${hash}', '${ch}', 120) as ok`,
  )).rows[0].ok;
const consume = async (db: Client, who: number, hash: string) =>
  (await db.queryObject<{ ch: string | null }>(`select public.passkey_device_link_consume(${who}, '${hash}') as ch`))
    .rows[0].ch;

Deno.test("ссылка гасится ровно один раз и отдаёт взведённый вызов", async () => {
  await scenario(async (db) => {
    assert(await issue(db, ANNA, "h-one"));
    assertEquals(await consume(db, ANNA, "h-one"), null, "невзведённый вызов не гасит ссылку");
    assert(await arm(db, ANNA, "h-one", "ch-a"));
    assertEquals(await consume(db, ANNA, "h-one"), "ch-a");
    assertEquals(await consume(db, ANNA, "h-one"), null, "повторное гашение прошло");
    assertEquals(await arm(db, ANNA, "h-one"), false, "погашенную ссылку взвели снова");
  });
});

Deno.test("ссылка Анны не работает под Борисом и остаётся целой для Анны", async () => {
  await scenario(async (db) => {
    assert(await issue(db, ANNA, "h-anna"));
    assertEquals(await arm(db, BORIS, "h-anna"), false);
    assert(await arm(db, ANNA, "h-anna", "ch-anna"));
    assertEquals(await consume(db, BORIS, "h-anna"), null);
    assertEquals(await consume(db, ANNA, "h-anna"), "ch-anna");
  });
});

Deno.test("просроченная ссылка и просроченный вызов не проходят", async () => {
  await scenario(async (db) => {
    assert(await issue(db, ANNA, "h-old"));
    await db.queryArray(
      `update public.passkey_device_links set expires_at = now() - interval '1 second' where token_hash = 'h-old'`,
    );
    assertEquals(await arm(db, ANNA, "h-old"), false, "просроченную ссылку взвели");

    assert(await issue(db, ANNA, "h-live"));
    assert(await arm(db, ANNA, "h-live"));
    await db.queryArray(
      `update public.passkey_device_links set challenge_expires_at = now() - interval '1 second'
       where token_hash = 'h-live'`,
    );
    assertEquals(await consume(db, ANNA, "h-live"), null, "просроченный вызов принят");
  });
});

Deno.test("новая ссылка гасит прежнюю; лимит выдачи держится; чужой лимит не тратится", async () => {
  await scenario(async (db) => {
    assert(await issue(db, ANNA, "h-1"));
    assert(await issue(db, ANNA, "h-2"));
    assertEquals(await arm(db, ANNA, "h-1"), false, "прежняя ссылка жива после выдачи новой");
    assert(await arm(db, ANNA, "h-2"));
    assert(await issue(db, ANNA, "h-3"));
    assertEquals(await issue(db, ANNA, "h-4", 3), false, "лимит не сработал");
    const n = await db.queryObject<{ n: number }>(
      `select count(*)::int as n from public.passkey_device_links where telegram_id = ${ANNA}`,
    );
    assertEquals(n.rows[0].n, 3, "отказ по лимиту что-то записал");
    assert(await issue(db, BORIS, "h-b", 3));
    assertEquals(await issue(db, 800000949, "h-nobody"), false, "ссылка выдана человеку не из allowed_users");
  });
});

Deno.test("замок: anon и authenticated не читают ссылки и не зовут функции, service_role — может", async () => {
  await scenario(async (db) => {
    const has = async (sql: string) => (await db.queryObject<{ ok: boolean }>(`select ${sql} as ok`)).rows[0].ok;
    const fns = [
      "public.passkey_device_link_issue(bigint, text, integer, integer, integer)",
      "public.passkey_device_link_arm(bigint, text, text, integer)",
      "public.passkey_device_link_consume(bigint, text)",
    ];
    for (const role of ["anon", "authenticated"]) {
      assertEquals(
        await has(`has_table_privilege('${role}', 'public.passkey_device_links', 'select')`),
        false,
        `${role} читает ссылки`,
      );
      for (const fn of fns) {
        assertEquals(await has(`has_function_privilege('${role}', '${fn}', 'execute')`), false, `${role} зовёт ${fn}`);
      }
    }
    for (const fn of fns) {
      assertEquals(await has(`has_function_privilege('service_role', '${fn}', 'execute')`), true, fn);
    }
    const rls = await db.queryObject<{ on: boolean }>(
      `select relrowsecurity as on from pg_class where oid = 'public.passkey_device_links'::regclass`,
    );
    assertEquals(rls.rows[0].on, true, "RLS выключен");
  });
});
