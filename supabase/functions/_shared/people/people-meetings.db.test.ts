// Участники встреч → справочник людей (#887) — триггер на НАСТОЯЩЕЙ базе.
//
// Ошибка здесь молчаливая: справочник просто не пополняется (или в нём заводятся переговорки и
// дубли), а в поле «Исполнитель» не находится человек, с которым была встреча вчера. Хуже того,
// сломанный триггер на meetings ронял бы запись встречи рекордером. Держит это миграция
// 20261009150000_people_from_meetings.sql.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const WS = "test-people-887";
const ACC_TG = 900887001;
const T1 = "2026-10-01T10:00:00Z";
const T2 = "2026-10-05T10:00:00Z";

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
  await db.queryArray`reset role`;
  await db.queryArray`delete from meetings where group_id = ${WS}`;
  await db.queryArray`delete from allowed_users where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`; // people уходят каскадом
}

type PersonRow = { email: string; display_name: string; source: string; last_met_at: string | null };

async function people(db: Client): Promise<Map<string, PersonRow>> {
  const { rows } = await db.queryObject<PersonRow>`
    select email, display_name, source, to_char(last_met_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_met_at
      from people where group_id = ${WS} and archived_at is null`;
  return new Map(rows.map((r) => [r.email, r]));
}

async function meeting(db: Client, key: string, attendees: unknown, startedAt: string | null): Promise<string> {
  const { rows } = await db.queryArray<[string]>`
    insert into meetings (identity_kind, identity_key, title, started_at, attendees, group_id)
    values ('calendar', ${key}, ${key}, ${startedAt}::timestamptz, ${JSON.stringify(attendees)}::jsonb, ${WS})
    returning id::text`;
  return rows[0][0];
}

Deno.test("участники встреч заводятся в справочник, переговорки и дубли — нет (#887)", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id, email)
      values (${ACC_TG}, 'acc887', ${ACC_TG}, ${WS}, 'acc887@example.com')`;
    const { rows: before } = await db.queryArray`select count(*)::int from people where group_id = ${WS}`;
    assertEquals(before[0][0], 1, "до встреч в справочнике только аккаунт");

    // Встречу пишет приложение — под service_role: без прав на функцию триггера запись встречи
    // упала бы (или справочник молча не пополнился бы).
    await db.queryArray`set role service_role`;
    await meeting(db, "k887-1", [
      { email: "Guest887@Example.com ", name: "Гость Первый" },
      { email: "noname887@example.com" },
      { email: "ACC887@example.com", name: "Аккаунт под другим регистром" },
      { email: "room887@example.com", name: "Переговорка с флагом", resource: true },
      { email: "c_123@resource.calendar.google.com", name: "Переговорка без флага" },
      { name: "Без почты" },
      { email: "guest887@example.com", name: "Дубль внутри встречи" },
    ], T1);
    await db.queryArray`reset role`;

    let ppl = await people(db);
    assertEquals(
      [...ppl.keys()].sort(),
      ["acc887@example.com", "guest887@example.com", "noname887@example.com"],
      "заведены участники с почтой; переговорки (оба признака) и дубль — нет",
    );
    assertEquals(ppl.get("guest887@example.com")!.display_name, "Гость Первый");
    assertEquals(ppl.get("guest887@example.com")!.source, "calendar");
    assertEquals(ppl.get("noname887@example.com")!.display_name, "noname887", "без имени — локальная часть почты");
    assertEquals(ppl.get("acc887@example.com")!.source, "account", "аккаунт не продублирован");
    assertEquals(ppl.get("acc887@example.com")!.last_met_at, T1, "аккаунту тоже двигается последняя встреча");
    assertEquals(ppl.get("guest887@example.com")!.last_met_at, T1);

    // Второй записавший дописал участников UPDATE-ом, у встречи позже — новый человек и сдвиг даты.
    const m2 = await meeting(db, "k887-2", [{ email: "noname887@example.com", name: "Уже есть" }], T2);
    await db.queryArray`
      update meetings set attendees = attendees || '[{"email":"late887@example.com","name":"Поздний"}]'::jsonb
       where id = ${m2}::uuid`;
    ppl = await people(db);
    assertEquals(ppl.get("late887@example.com")?.display_name, "Поздний", "UPDATE участников тоже заводит");
    assertEquals(ppl.get("noname887@example.com")!.display_name, "noname887", "имя существующего не трогаем");
    assertEquals(ppl.get("noname887@example.com")!.last_met_at, T2, "последняя встреча сдвинулась");
    assertEquals(ppl.get("guest887@example.com")!.last_met_at, T1, "у не бывшего на встрече — прежняя");

    // Старая встреча, записанная позже новой, дату назад не откатывает.
    await meeting(db, "k887-3", [{ email: "noname887@example.com" }], T1);
    assertEquals((await people(db)).get("noname887@example.com")!.last_met_at, T2, "дата только вперёд");

    // Мусор в участниках не роняет запись встречи и ничего не заводит.
    const count = async () =>
      ((await db.queryArray`select count(*)::int from people where group_id = ${WS}`).rows[0][0]) as number;
    const n = await count();
    for (
      const [i, junk] of [null, {}, "строка", 42, [null, 1, "x", [], { email: 5 }, { email: "без-собаки" }]].entries()
    ) {
      await meeting(db, `k887-junk-${i}`, junk, T2);
    }
    const { rows: noStart } = await db.queryArray<[string]>`
      insert into meetings (identity_kind, identity_key, group_id, attendees)
      values ('manual', 'manual:k887-null', ${WS}, '[{"email":"nostart887@example.com"}]'::jsonb) returning id::text`;
    assert(noStart.length === 1, "встреча без времени начала записалась");
    assertEquals(await count(), n + 1, "мусор ничего не завёл; встреча без начала — по created_at");
    assert((await people(db)).get("nostart887@example.com")!.last_met_at, "у встречи без начала дата — created_at");

    // Встреча без воркспейса пропускается.
    await db.queryArray`
      insert into meetings (identity_kind, identity_key, attendees)
      values ('manual', 'manual:k887-nogroup', '[{"email":"nogroup887@example.com"}]'::jsonb)`;
    const { rows: ng } = await db.queryArray`select count(*)::int from people where email = 'nogroup887@example.com'`;
    assertEquals(ng[0][0], 0, "без воркспейса никого не заводим");
    await db.queryArray`delete from meetings where identity_key = 'manual:k887-nogroup'`;
  } finally {
    await db.queryArray`delete from meetings where identity_key = 'manual:k887-nogroup'`;
    await cleanup(db);
    await db.end();
  }
});
