// Несколько стран у задачи (issue #1262) — на НАСТОЯЩЕЙ базе.
//
// Почему на базе: ядро здесь — бэкфилл старых значений `country` в коды (SQL миграции, который
// иначе не проверить), фильтр «любая из стран» (`countries && …`) и то, что видимость задач
// закрытых проектов от фильтра не меняется. Мок проверил бы нашу модель базы, а не базу.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321");
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

const { createTask, getTask, listTasksWithTotal, TaskUserError, updateTask } = await import("./db.ts");

const WS = "t_tcountries";
const AUTHOR = 880000401;
const MEMBER = 880000402;
const MIGRATION = new URL("../../../migrations/20261110120000_task_countries.sql", import.meta.url);

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с локальной базой (${DB_URL}). Подними контур: supabase start && supabase db reset. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return db;
}

async function reset(db: Client) {
  await db.queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
}

const countriesOf = async (db: Client, id: string) =>
  (await db.queryObject<{ countries: string[]; country: string | null }>`
    select countries, country from tasks where id = ${id}`).rows[0];

Deno.test("бэкфилл: имена и коды приводятся к ISO-2, нераспознанное остаётся пустым и не угадывается", async () => {
  const db = await connect();
  try {
    await reset(db);
    // Старые строки родились до колонки: триггер синхронизации, который появился вместе с ней,
    // им не мешал. Выключаем его на время вставки, чтобы воспроизвести именно «до».
    const legacy: Record<string, string[]> = {
      "Словения": ["SI"],
      "Belarus": ["BY"],
      "RS": ["RS"],
      "PT": ["PT"],
      "RS, HU": ["RS", "HU"],
      "Serbia/Croatia": ["RS", "HR"],
      "United Arab Emirates": ["AE"],
      "EU": [], // не страна ISO — не угадываем
      "Атлантида": [],
      "RS, Нарния": [], // хоть один токен не разобрался — не берём и остальные
    };
    const ids = new Map<string, string>();
    await db.queryArray`set session_replication_role = replica`;
    for (const value of Object.keys(legacy)) {
      const r = await db.queryObject<{ id: string }>`
        insert into tasks (title, status, group_id, created_by, confirmed, country)
        values (${value}, 'open', ${WS}, 'test', true, ${value}) returning id`;
      ids.set(value, r.rows[0].id);
    }
    await db.queryArray`set session_replication_role = default`;
    await db.queryArray`update tasks set countries = '{}' where group_id = ${WS}`;

    // Прогоняем тот же SQL, что уйдёт на прод: всё до ограничения (оно уже стоит, второй раз
    // его не добавить). Своя копия бэкфилла в тесте проверяла бы саму себя.
    const sql = await Deno.readTextFile(MIGRATION);
    const cut = sql.indexOf("alter table public.tasks add constraint");
    assert(cut > 0, "в миграции нет ожидаемого ограничения — тест надо обновить вместе с ней");
    await db.queryArray(sql.slice(0, cut));

    for (const [value, expected] of Object.entries(legacy)) {
      const row = await countriesOf(db, ids.get(value)!);
      assertEquals(row.countries, expected, `«${value}»`);
      // Нераспознанное значение остаётся в старой колонке как было. (У разобранных `country`
      // здесь зеркалится триггером — на проде бэкфилл идёт до его создания, там значение не
      // меняется; на тест это не влияет: читают одну `countries`.)
      if (expected.length === 0) assertEquals(row.country, value, `«${value}»`);
    }
  } finally {
    await db.queryArray`set session_replication_role = default`;
    await db.end();
  }
});

Deno.test("ограничение базы: в countries только двухбуквенные коды заглавными", async () => {
  const db = await connect();
  try {
    await reset(db);
    const id = (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by, confirmed) values ('c', 'open', ${WS}, 'test', true)
      returning id`).rows[0].id;
    for (const bad of ["{rs}", "{RUS}", "{R}", '{""}', "{RS,NULL}"]) {
      await assertRejects(
        () => db.queryArray(`update tasks set countries = '${bad}' where id = '${id}'`),
        Error,
        "tasks_countries_iso2",
        bad,
      );
    }
  } finally {
    await db.end();
  }
});

Deno.test("триггер: country и countries совпадают, откуда бы ни пришла запись", async () => {
  const db = await connect();
  try {
    await reset(db);
    const id = (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by, confirmed, country)
      values ('t', 'open', ${WS}, 'test', true, 'HU') returning id`).rows[0].id;
    assertEquals(await countriesOf(db, id), { countries: ["HU"], country: "HU" }); // писатель мимо кода (демо-сид)
    await db.queryArray`update tasks set countries = array['RS','HU'] where id = ${id}`;
    assertEquals(await countriesOf(db, id), { countries: ["RS", "HU"], country: "RS" });
    await db.queryArray`update tasks set country = 'PT' where id = ${id}`;
    assertEquals(await countriesOf(db, id), { countries: ["PT"], country: "PT" });
    await db.queryArray`update tasks set country = 'Словения' where id = ${id}`;
    assertEquals((await countriesOf(db, id)).countries, []);
  } finally {
    await db.end();
  }
});

Deno.test("запись из кода: список, одиночный country и имена — всё приводится к кодам, country зеркалит первую", async () => {
  const db = await connect();
  try {
    await reset(db);
    const mk = async (extra: Record<string, unknown>) =>
      await createTask({ title: "t", confirmed: true, status: "open", ...extra }, WS);

    const multi = await mk({ countries: ["hu", "Сербия", "HU"] });
    assertEquals([multi.countries, multi.country], [["HU", "RS"], "HU"]);
    assertEquals(await countriesOf(db, multi.id), { countries: ["HU", "RS"], country: "HU" });

    const legacy = await mk({ country: "Belarus" }); // старый клиент: одно имя
    assertEquals(await countriesOf(db, legacy.id), { countries: ["BY"], country: "BY" });

    const none = await mk({});
    assertEquals(await countriesOf(db, none.id), { countries: [], country: null });

    await updateTask(multi.id, { countries: ["PT", "NL", "RS"] });
    assertEquals(await countriesOf(db, multi.id), { countries: ["PT", "NL", "RS"], country: "PT" });
    await updateTask(multi.id, { country: "Cyprus" });
    assertEquals(await countriesOf(db, multi.id), { countries: ["CY"], country: "CY" });
    await updateTask(multi.id, { countries: [] });
    assertEquals(await countriesOf(db, multi.id), { countries: [], country: null });
    // Правка другого поля страны не трогает.
    await updateTask(legacy.id, { title: "новое имя" });
    assertEquals((await countriesOf(db, legacy.id)).countries, ["BY"]);

    // Журнал: одна строка «country» со списком, а не две.
    const hist = (await db.queryObject<{ field: string; new_value: string | null }>`
      select field, new_value from task_history where task_id = ${multi.id} and field like 'countr%' order by created_at`)
      .rows;
    assertEquals(hist.map((h) => h.field), ["country", "country", "country"]);
    assertEquals(hist[0].new_value, "PT, NL, RS");
  } finally {
    await db.end();
  }
});

Deno.test("неизвестная страна — ошибка 400, задача не создаётся и не меняется", async () => {
  const db = await connect();
  try {
    await reset(db);
    const e = await assertRejects(
      () => createTask({ title: "x", countries: ["HU", "Атлантида"] }, WS),
      TaskUserError,
      "Атлантида",
    );
    assertEquals(e.status, 400);
    assertEquals((await db.queryArray`select 1 from tasks where group_id = ${WS}`).rows.length, 0);

    const t = await createTask({ title: "y", countries: ["HU"], confirmed: true }, WS);
    await assertRejects(() => updateTask(t.id, { countries: ["HU", "ZZ"] }), TaskUserError, "ZZ");
    await assertRejects(() => updateTask(t.id, { country: "EU" }), TaskUserError, "EU");
    assertEquals((await getTask(t.id))!.countries, ["HU"]);
  } finally {
    await db.end();
  }
});

Deno.test("фильтр: задача подходит, если ЛЮБАЯ из её стран в запросе; видимость закрытых проектов не меняется", async () => {
  const db = await connect();
  try {
    await reset(db);
    const closed = (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private) values (${WS}, 'Закрытый', ${AUTHOR}, true)
      returning id`).rows[0].id;
    const mk = (title: string, countries: string[], project_id: string | null = null) =>
      createTask({ title, countries, project_id, confirmed: true, status: "open" }, WS);
    await mk("hu", ["HU"]);
    await mk("hu+rs", ["HU", "RS"]);
    await mk("rs+me", ["RS", "ME"]);
    await mk("pt", ["PT"]);
    await mk("без страны", []);
    await mk("rs в закрытом", ["RS"], closed);

    const titles = async (countries: string[] | undefined, viewerId: number) =>
      (await listTasksWithTotal({ countries, viewerId, limit: 50 }, WS)).tasks.map((t) => t.title).sort();

    assertEquals(await titles(["HU"], MEMBER), ["hu", "hu+rs"]);
    assertEquals(await titles(["RS"], MEMBER), ["hu+rs", "rs+me"]); // закрытый проект не виден
    assertEquals(await titles(["RS"], AUTHOR), ["hu+rs", "rs+me", "rs в закрытом"]);
    assertEquals(await titles(["HU", "ME"], MEMBER), ["hu", "hu+rs", "rs+me"]); // «любая из»
    assertEquals(await titles(["NL"], MEMBER), []);
    // Без фильтра выдача прежняя — видимость от стран не зависит.
    assertEquals(await titles(undefined, MEMBER), ["hu", "hu+rs", "pt", "rs+me", "без страны"]);
    assertEquals((await titles(undefined, AUTHOR)).length, 6);
  } finally {
    await db.end();
  }
});
