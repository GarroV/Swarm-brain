// Участники встреч → справочник людей (#887) — триггеры на НАСТОЯЩЕЙ базе.
//
// Ошибка здесь молчаливая: справочник просто не пополняется (или в нём заводятся переговорки и
// дубли), а в поле «Исполнитель» не находится человек, с которым была встреча вчера. Хуже —
// утечка: справочник видит весь воркспейс, и участник ЛИЧНОЙ встречи или черновика в нём
// раскрыл бы, с кем и когда встречался владелец. И сломанный триггер на meetings ронял бы
// запись встречи рекордером. Держит это миграция 20261009150000_people_from_meetings.sql.
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
const T3 = "2026-10-08T10:00:00Z";

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
  await db.queryArray`delete from meetings where group_id = ${WS} or identity_key = 'manual:k887-nogroup'`;
  await db.queryArray`delete from entries where group_id = ${WS}`;
  await db.queryArray`delete from allowed_users where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`; // people уходят каскадом
}

type PersonRow = { email: string; display_name: string; source: string; last_met_at: string | null };

async function people(db: Client): Promise<Map<string, PersonRow>> {
  const { rows } = await db.queryObject<PersonRow>`
    select email, display_name, source,
           to_char(last_met_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_met_at
      from people where group_id = ${WS} and archived_at is null`;
  return new Map(rows.map((r: PersonRow) => [r.email, r]));
}

async function entry(db: Client, isPrivate: boolean): Promise<string> {
  const { rows } = await db.queryArray<[string]>`
    insert into entries (content, entry_type, source, added_by, is_private, owner_id, group_id)
    values ('встреча 887', 'meeting', 'test', 'test', ${isPrivate}, ${ACC_TG}, ${WS}) returning id::text`;
  return rows[0][0];
}

type Vis = "public" | "private" | "draft";

/** Встреча, как её видит воркспейс: общая (опубликована в общую базу), личная или черновик. */
async function meeting(db: Client, key: string, attendees: unknown, startedAt: string | null, vis: Vis = "public") {
  const entryId = vis === "draft" ? null : await entry(db, vis === "private");
  const { rows } = await db.queryArray<[string]>`
    insert into meetings (identity_kind, identity_key, title, started_at, attendees, group_id, status, entry_id)
    values ('calendar', ${key}, ${key}, ${startedAt}::timestamptz, ${JSON.stringify(attendees)}::jsonb, ${WS},
            ${vis === "draft" ? "awaiting_review" : "in_base"}, ${entryId}::uuid)
    returning id::text`;
  return { id: rows[0][0], entryId };
}

Deno.test("участники ОБЩИХ встреч заводятся в справочник, переговорки и дубли — нет (#887)", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id, email)
      values (${ACC_TG}, 'acc887', ${ACC_TG}, ${WS}, 'acc887@example.com')`;
    const { rows: before } = await db.queryArray`select count(*)::int from people where group_id = ${WS}`;
    assertEquals(before[0][0], 1, "до встреч в справочнике только аккаунт");

    // Встречу пишет приложение — под service_role: без прав на функции триггера справочник молча
    // не пополнился бы.
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

    // Второй записавший дописал участников UPDATE-ом, встреча позже — новый человек и сдвиг даты.
    const m2 = await meeting(db, "k887-2", [{ email: "noname887@example.com", name: "Уже есть" }], T2);
    await db.queryArray`
      update meetings set attendees = attendees || '[{"email":"late887@example.com","name":"Поздний"}]'::jsonb
       where id = ${m2.id}::uuid`;
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
    const junks = [null, {}, "строка", 42, [null, 1, "x", [], { email: 5 }, { email: "без-собаки" }]];
    for (const [i, junk] of junks.entries()) await meeting(db, `k887-junk-${i}`, junk, T2);
    assertEquals(await count(), n, "мусор ничего не завёл");

    // Встреча без времени начала — дата по created_at.
    const e0 = await entry(db, false);
    await db.queryArray`
      insert into meetings (identity_kind, identity_key, group_id, attendees, status, entry_id)
      values ('manual', 'manual:k887-null', ${WS}, '[{"email":"nostart887@example.com"}]'::jsonb, 'in_base', ${e0}::uuid)`;
    assert((await people(db)).get("nostart887@example.com")?.last_met_at, "у встречи без начала дата — created_at");

    // Встреча без воркспейса пропускается.
    await db.queryArray`
      insert into meetings (identity_kind, identity_key, attendees)
      values ('manual', 'manual:k887-nogroup', '[{"email":"nogroup887@example.com"}]'::jsonb)`;
    const { rows: ng } = await db.queryArray`select count(*)::int from people where email = 'nogroup887@example.com'`;
    assertEquals(ng[0][0], 0, "без воркспейса никого не заводим");
  } finally {
    await cleanup(db);
    await db.end();
  }
});

Deno.test("участники ЛИЧНЫХ встреч и черновиков в справочник не попадают (#887)", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id, email)
      values (${ACC_TG}, 'acc887', ${ACC_TG}, ${WS}, 'acc887@example.com')`;
    await meeting(db, "k887-pub", [{ email: "known887@example.com", name: "Знакомый" }], T1);

    await db.queryArray`set role service_role`;
    const priv = await meeting(
      db,
      "k887-priv",
      [
        { email: "secret887@example.com", name: "Тайный" },
        { email: "known887@example.com" },
        { email: "acc887@example.com" },
      ],
      T3,
      "private",
    );
    const draft = await meeting(
      db,
      "k887-draft",
      [
        { email: "draft887@example.com", name: "Черновой" },
        { email: "known887@example.com" },
      ],
      T3,
      "draft",
    );
    await db.queryArray`reset role`;

    let ppl = await people(db);
    assertEquals(ppl.has("secret887@example.com"), false, "участник личной встречи не заведён");
    assertEquals(ppl.has("draft887@example.com"), false, "участник черновика не заведён");
    assertEquals(ppl.get("known887@example.com")!.last_met_at, T1, "личная встреча и черновик не двигают дату");
    assertEquals(ppl.get("acc887@example.com")!.last_met_at, null, "и аккаунту тоже");

    // Черновик опубликовали в общую базу — его участники появляются.
    const e = await entry(db, false);
    await db.queryArray`set role service_role`;
    await db.queryArray`update meetings set entry_id = ${e}::uuid, status = 'in_base' where id = ${draft.id}::uuid`;
    await db.queryArray`reset role`;
    ppl = await people(db);
    assertEquals(ppl.get("draft887@example.com")?.display_name, "Черновой", "публикация в общие заводит");
    assertEquals(ppl.get("known887@example.com")!.last_met_at, T3);

    // Личную запись перевели в общие — заводятся и её участники.
    await db.queryArray`update entries set is_private = false where id = ${priv.entryId}::uuid`;
    assertEquals((await people(db)).get("secret887@example.com")?.display_name, "Тайный", "личная → общая заводит");

    // Обратно в личные — заведённых не удаляем, новые от неё не заводятся.
    await db.queryArray`update entries set is_private = true where id = ${priv.entryId}::uuid`;
    await db.queryArray`
      update meetings set attendees = attendees || '[{"email":"after887@example.com"}]'::jsonb
       where id = ${priv.id}::uuid`;
    ppl = await people(db);
    assert(ppl.has("secret887@example.com"), "уже заведённый остаётся");
    assertEquals(ppl.has("after887@example.com"), false, "новый участник личной встречи не заведён");
  } finally {
    await cleanup(db);
    await db.end();
  }
});
