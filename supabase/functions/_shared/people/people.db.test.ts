// Справочник людей и соисполнители (#874) — триггеры на НАСТОЯЩЕЙ базе.
//
// Ошибка здесь молчаливая: человек без входа вошёл, а его задачи так и не появились у него в
// «Моих задачах», или соисполнитель не видит задачу, на которую его поставили. Ни одна
// проверка типов этого не заметит — держат триггеры миграции 20261008220000_people.sql.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const WS = "test-people-874";
const ACC_TG = 900874001; // аккаунт, который есть с самого начала
const LATE_TG = 900874002; // фантом, который потом войдёт через Google
const INVITE_TG = 900874003; // приглашённый по почте, вошёл позже

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с локальной базой (${DB_URL}): подними контур и сбрось базу. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return db;
}

async function cleanup(db: Client) {
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from people where group_id = ${WS}`;
  await db.queryArray`delete from allowed_users where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
}

type TaskRow = {
  assignee_telegram_ids: number[];
  assignee_person_id: string | null;
  coassignee_telegram_ids: number[];
};

async function task(db: Client, id: string): Promise<TaskRow> {
  const { rows } = await db.queryObject<TaskRow>`
    select assignee_telegram_ids::int8[] as assignee_telegram_ids, assignee_person_id::text,
           coassignee_telegram_ids::int8[] as coassignee_telegram_ids
      from tasks where id = ${id}::uuid`;
  const r = rows[0];
  return {
    assignee_telegram_ids: (r.assignee_telegram_ids ?? []).map(Number),
    assignee_person_id: r.assignee_person_id,
    coassignee_telegram_ids: (r.coassignee_telegram_ids ?? []).map(Number).sort(),
  };
}

async function personId(db: Client, where: { email?: string; tg?: number }): Promise<string> {
  const { rows } = where.email
    ? await db.queryArray<[string]>`select id::text from people where group_id = ${WS} and email = ${where.email}`
    : await db.queryArray<[string]>`
        select p.id::text from people p join allowed_users au on au.id = p.account_id
         where au.telegram_id = ${where.tg}`;
  assert(rows.length === 1, `человек не найден: ${JSON.stringify(where)}`);
  return rows[0][0];
}

Deno.test("люди без входа: исполнитель и соисполнители переезжают на аккаунт при входе (#874)", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;

    // Аккаунт заводится — запись в справочнике появляется сама.
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id, email)
      values (${ACC_TG}, 'acc874', ${ACC_TG}, ${WS}, 'Acc874@Example.com')`;
    const accPerson = await personId(db, { tg: ACC_TG });

    // Фантом: завели вручную из задачи, с почтой.
    const { rows: ph } = await db.queryArray<[string]>`
      insert into people (group_id, display_name, email, source, created_by)
      values (${WS}, 'Поздний Фантом', 'late874@example.com', 'manual', ${ACC_TG}) returning id::text`;
    const phantom = ph[0][0];

    // Задача: исполнитель — фантом, соисполнители — фантом и аккаунт.
    const { rows: t1 } = await db.queryArray<[string]>`
      insert into tasks (title, group_id, assignees, assignee_person_id, coassignee_person_ids)
      values ('t874-a', ${WS}, ${["Поздний Фантом"]}, ${phantom}::uuid,
              ${[phantom, accPerson]}::uuid[]) returning id::text`;
    const taskA = t1[0][0];
    assertEquals(await task(db, taskA), {
      assignee_telegram_ids: [],
      assignee_person_id: phantom,
      coassignee_telegram_ids: [ACC_TG],
    }, "у фантома нет telegram — в «мои» попадает только аккаунт-соисполнитель");

    // Фантом вошёл через Google с той же почтой (другой регистр) — запись связалась, задачи у него.
    // Под service_role, как пишет приложение: без прав на people и функции связывания вход
    // падал бы целиком (поймано живым прогоном 09.10).
    await db.queryArray`set role service_role`;
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id, email)
      values (${LATE_TG}, 'late874', ${ACC_TG}, ${WS}, ' LATE874@example.com ')`;
    await db.queryArray`reset role`;
    assertEquals(await personId(db, { tg: LATE_TG }), phantom, "вход по почте связал, а не завёл дубль");
    assertEquals(await task(db, taskA), {
      assignee_telegram_ids: [LATE_TG],
      assignee_person_id: null,
      coassignee_telegram_ids: [ACC_TG, LATE_TG].sort(),
    }, "исполнитель переехал на аккаунт, соисполнитель тоже видит задачу");

    // Приглашённый по почте без telegram: запись есть сразу, задачи едут при первом входе.
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id, email)
      values (null, null, ${ACC_TG}, ${WS}, 'invite874@example.com')`;
    const invited = await personId(db, { email: "invite874@example.com" });
    const { rows: t2 } = await db.queryArray<[string]>`
      insert into tasks (title, group_id, assignees, assignee_person_id, coassignee_person_ids)
      values ('t874-b', ${WS}, ${["invite874@example.com"]}, ${invited}::uuid, ${[invited]}::uuid[])
      returning id::text`;
    const taskB = t2[0][0];
    assertEquals((await task(db, taskB)).assignee_telegram_ids, [], "до входа задача не его");
    await db
      .queryArray`update allowed_users set telegram_id = ${INVITE_TG} where group_id = ${WS} and email = 'invite874@example.com'`;
    assertEquals(await task(db, taskB), {
      assignee_telegram_ids: [INVITE_TG],
      assignee_person_id: null,
      coassignee_telegram_ids: [INVITE_TG],
    }, "первый вход приглашённого перевёл его задачи на аккаунт");

    // Исполнитель-аккаунт поставлен ботом/MCP по старой колонке — фантом-исполнитель снимается.
    const { rows: t3 } = await db.queryArray<[string]>`
      insert into tasks (title, group_id, assignee_person_id) values ('t874-c', ${WS}, ${phantom}::uuid)
      returning id::text`;
    await db.queryArray`update tasks set assignee_telegram_ids = ${[ACC_TG]}::int8[] where id = ${t3[0][0]}::uuid`;
    assertEquals((await task(db, t3[0][0])).assignee_person_id, null, "один исполнитель, а не два");
  } finally {
    await cleanup(db);
    await db.end();
  }
});
