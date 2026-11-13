// Таблица исходов заходов бота (#1244, миграция 20261113130000) на НАСТОЯЩЕЙ базе: внешний замок,
// список исходов в check совпадает с кодом (_shared/join-outcomes.ts), повтор не множит строки.
// Всё внутри транзакции с откатом. Тест не умеет «пропускаться»: базы нет — прогон падает.
import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";
import { JOIN_OUTCOMES } from "./join-outcomes.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TABLE = "public.scriba_join_outcomes";
const USER_ID = 9990013;
const GROUP = "outcomes-test";

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
    await db.queryArray(`insert into public.workspaces (id, name) values ('${GROUP}', 'Outcomes test')`);
    await db.queryArray(
      `insert into public.allowed_users (telegram_id, added_by, group_id) values (${USER_ID}, ${USER_ID}, '${GROUP}')`,
    );
    await run(db);
  } finally {
    await db.queryArray("rollback").catch(() => undefined);
    await db.end();
  }
}

const insert = (db: Client, outcome: string, key = "k1") =>
  db.queryArray(
    `insert into ${TABLE} (group_id, invited_by, outcome, source, outcome_key)
     values ('${GROUP}', ${USER_ID}, $1, 'notice', $2)`,
    [outcome, key],
  );

Deno.test("исходы: anon/authenticated ничего не читают и не пишут, service_role работает, RLS включён", async () => {
  await scenario(async (db) => {
    const r = await db.queryArray<[boolean, boolean, boolean, boolean, boolean]>(
      `select has_table_privilege('anon', '${TABLE}', 'select'),
              has_table_privilege('authenticated', '${TABLE}', 'select'),
              has_table_privilege('anon', '${TABLE}', 'insert'),
              has_table_privilege('service_role', '${TABLE}', 'insert'),
              (select relrowsecurity from pg_class where oid = '${TABLE}'::regclass)`,
    );
    assertEquals(r.rows[0], [false, false, false, true, true]);
  });
});

Deno.test("исходы: check принимает ровно те исходы, что знает код", async () => {
  await scenario(async (db) => {
    for (const outcome of JOIN_OUTCOMES) await insert(db, outcome, `k-${outcome}`);
    const n = await db.queryArray<[bigint]>(`select count(*) from ${TABLE}`);
    assertEquals(Number(n.rows[0][0]), JOIN_OUTCOMES.length);
  });
  await scenario(async (db) => {
    await assertRejects(() => insert(db, "recorded"), Error, "check");
  });
});

Deno.test("исходы: повтор (человек + ключ + исход) не множит строки при upsert с ignoreDuplicates", async () => {
  await scenario(async (db) => {
    const sql = `insert into ${TABLE} (group_id, invited_by, outcome, source, outcome_key)
                 values ('${GROUP}', ${USER_ID}, 'door_timeout', 'notice', 'm1')
                 on conflict (invited_by, outcome_key, outcome) do nothing`;
    await db.queryArray(sql);
    await db.queryArray(sql);
    const n = await db.queryArray<[bigint]>(`select count(*) from ${TABLE}`);
    assertEquals(Number(n.rows[0][0]), 1);
    await insert(db, "door_denied", "m1");
    const m = await db.queryArray<[bigint]>(`select count(*) from ${TABLE}`);
    assertEquals(Number(m.rows[0][0]), 2, "другой исход той же встречи — отдельная строка");
  });
});
