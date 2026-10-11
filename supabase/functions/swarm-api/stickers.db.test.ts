// Стикеры на главной на настоящей базе: внешний замок (anon/authenticated ничего не читают),
// ограничения на ссылку и цвет, поведение связей при удалении. Тот же замок, что у people и
// short_links: политик нет, ходит только service_role (#41).
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const WS = "t-stickers";

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

async function reset(db: Client): Promise<void> {
  // tasks.group_id без каскада: задачи фикстуры убираем сами.
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
}

Deno.test("anon/authenticated не читают и не пишут стикеры, service_role работает", async () => {
  const db = await connect();
  try {
    for (const table of ["board_stickers", "board_sticker_people"]) {
      const r = await db.queryArray<[boolean, boolean, boolean, boolean, boolean, boolean]>`
        select has_table_privilege('anon', ${"public." + table}, 'select'),
               has_table_privilege('authenticated', ${"public." + table}, 'select'),
               has_table_privilege('anon', ${"public." + table}, 'insert'),
               has_table_privilege('authenticated', ${"public." + table}, 'update'),
               has_table_privilege('service_role', ${"public." + table}, 'select'),
               has_table_privilege('service_role', ${"public." + table}, 'insert')`;
      assertEquals(r.rows[0], [false, false, false, false, true, true], table);
    }
    const rls = await db.queryArray<[string, boolean]>`
      select relname, relrowsecurity from pg_class
       where relname in ('board_stickers', 'board_sticker_people') and relnamespace = 'public'::regnamespace
       order by relname`;
    assertEquals(rls.rows, [["board_sticker_people", true], ["board_stickers", true]]);
  } finally {
    await db.end();
  }
});

Deno.test("база отбивает опасную ссылку, чужой цвет и пустой заголовок", async () => {
  const db = await connect();
  try {
    await reset(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    const ok = async (link: string | null) =>
      await db.queryArray`insert into board_stickers (group_id, kind, title, link, created_by)
        values (${WS}, 'notice', 'ok', ${link}, 1)`;
    await ok(null);
    await ok("https://example.com/a");
    await ok("/tasks");
    for (const bad of ["javascript:alert(1)", "//evil.example.com", "https://a.com/ b", "ftp://a.com"]) {
      await assertRejects(() => ok(bad), Error, "", `ссылка ${bad} должна быть отбита`);
    }
    await assertRejects(() =>
      db.queryArray`insert into board_stickers (group_id, kind, title, tone, created_by)
        values (${WS}, 'notice', 'x', 'red', 1)`
    );
    await assertRejects(() =>
      db.queryArray`insert into board_stickers (group_id, kind, title, created_by)
        values (${WS}, 'notice', '   ', 1)`
    );
    await assertRejects(() =>
      db.queryArray`insert into board_stickers (group_id, kind, title, created_by)
        values (${WS}, 'other', 'x', 1)`
    );
  } finally {
    await reset(db);
    await db.end();
  }
});

Deno.test("удаление: стикер уносит адресатов, человек — свою строку, задача только отвязывается", async () => {
  const db = await connect();
  try {
    await reset(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    const p1 = (await db.queryArray<[string]>`insert into people (group_id, display_name, source)
      values (${WS}, 'A', 'manual') returning id`).rows[0][0];
    const p2 = (await db.queryArray<[string]>`insert into people (group_id, display_name, source)
      values (${WS}, 'B', 'manual') returning id`).rows[0][0];
    const task = (await db.queryArray<[string]>`insert into tasks (title, group_id, source)
      values ('t', ${WS}, 'board_sticker') returning id`).rows[0][0];
    const sticker = (await db.queryArray<[string]>`insert into board_stickers (group_id, kind, title, created_by)
      values (${WS}, 'task', 's', 1) returning id`).rows[0][0];
    await db.queryArray`insert into board_sticker_people (sticker_id, person_id, task_id)
      values (${sticker}, ${p1}, ${task}), (${sticker}, ${p2}, null)`;

    // Повторный адресат — тот же ключ.
    await assertRejects(() =>
      db.queryArray`insert into board_sticker_people (sticker_id, person_id) values (${sticker}, ${p1})`
    );

    await db.queryArray`delete from tasks where id = ${task}`;
    const afterTask = await db.queryArray<[string, string | null]>`
      select person_id, task_id from board_sticker_people where sticker_id = ${sticker}`;
    assertEquals(afterTask.rows.length, 2);
    assert(afterTask.rows.every((r) => r[1] === null), "task_id обнуляется, строка адресата остаётся");

    await db.queryArray`delete from people where id = ${p2}`;
    const afterPerson = await db.queryArray`select 1 from board_sticker_people where sticker_id = ${sticker}`;
    assertEquals(afterPerson.rows.length, 1);

    await db.queryArray`delete from board_stickers where id = ${sticker}`;
    const afterSticker = await db.queryArray`select 1 from board_sticker_people where sticker_id = ${sticker}`;
    assertEquals(afterSticker.rows.length, 0);
  } finally {
    await reset(db);
    await db.end();
  }
});
