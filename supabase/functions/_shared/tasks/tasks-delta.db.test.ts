// Дельта списка задач (`updatedAfter`) на НАСТОЯЩЕЙ базе: фильтр .or() по двум колонкам и
// сочетание с воркспейсом нельзя проверить моком. Тест не умеет «пропускаться»: базы нет —
// падает и говорит, что поднять (см. archive.db.test.ts).
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321");
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

const { deleteTask, listTasksWithTotal } = await import("./db.ts");

const WS = "t_delta";
const OTHER_WS = "t_delta_other";
const OLD = "2026-01-01T00:00:00.000Z";
const SINCE = "2026-06-01T00:00:00.000Z";

async function connect(): Promise<Client> {
  const client = new Client(DB_URL);
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с локальной базой (${DB_URL}). Подними контур: supabase start && supabase db reset. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return client;
}

async function seed(db: Client) {
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${ws})`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, 'Тестовый')`;
  }
}

async function addTask(db: Client, ws: string, title: string, updatedAt: string) {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, created_by, confirmed, updated_at)
    values (${title}, 'open', ${ws}, 'test', true, ${updatedAt})
    returning id`;
  return r.rows[0].id;
}

const COLS = "id,title,archived_at";

Deno.test("дельта: только изменённое после since, в своём воркспейсе", async () => {
  const db = await connect();
  try {
    await seed(db);
    await addTask(db, WS, "старая", OLD);
    await addTask(db, WS, "свежая", "2026-09-01T00:00:00.000Z");
    await addTask(db, OTHER_WS, "чужой воркспейс", "2026-09-01T00:00:00.000Z");

    const { tasks } = await listTasksWithTotal({ columns: COLS, updatedAfter: SINCE, confirmed: true }, WS);
    assertEquals(tasks.map((t) => t.title), ["свежая"]);
  } finally {
    await db.end();
  }
});

Deno.test("дельта: архивная задача возвращается с archived_at, в обычном списке её нет", async () => {
  const db = await connect();
  try {
    await seed(db);
    const id = await addTask(db, WS, "будет архивной", OLD);
    // Задача старая (updated_at до since), архивация идёт через archivePatch и updated_at не трогает.
    assert((await deleteTask(id, 1), true));

    const delta = await listTasksWithTotal({ columns: COLS, updatedAfter: SINCE, confirmed: true }, WS);
    assertEquals(delta.tasks.length, 1);
    assert((delta.tasks[0] as unknown as { archived_at: string | null }).archived_at !== null);

    const full = await listTasksWithTotal({ columns: COLS, confirmed: true }, WS);
    assertEquals(full.tasks.length, 0);
  } finally {
    await db.end();
  }
});
