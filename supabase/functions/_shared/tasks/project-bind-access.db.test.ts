// Привязка задачи к проекту — на НАСТОЯЩЕЙ базе: проверка видимости проекта вызывающему.
//
// Почему на базе: предикат canViewProject покрыт чистыми тестами, а здесь проверяется, что
// функция, которую зовут POST/PATCH /tasks, действительно тянет строки воркспейса и родителя
// и применяет предикат, а не ограничивается принадлежностью воркспейсу. Ошибка здесь не
// падает — она молча пропускает привязку к закрытой чужой строке.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) {
    throw new Error(
      `Не задана переменная ${name}. Подними локальный контур (supabase start) и прогоняй ` +
        `через ./scripts/check — он подставит доступы.`,
    );
  }
}

const { canViewProjectInWorkspace } = await import("./projects.ts");

const WS = "t_pbind";
const OTHER_WS = "t_pbind_other";
const AUTHOR = 880000101;
const MEMBER = 880000102;

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

async function seed(db: Client) {
  for (const ws of [WS, OTHER_WS]) {
    await db
      .queryArray`delete from project_history where project_id in (select id from projects where group_id = ${ws})`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db
      .queryArray`update projects set parent_id = null where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db
      .queryArray`insert into workspaces (id, name) values (${ws}, 'Привязка')`;
  }
}

// Строки кладём прямо SQL: проверяется чтение, а не путь создания проекта.
async function project(
  db: Client,
  ws: string,
  name: string,
  createdBy: number,
  parentId: string | null = null,
): Promise<{ id: string }> {
  const r = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name, created_by, parent_id)
    values (${ws}, ${name}, ${createdBy}, ${parentId}) returning id`;
  return r.rows[0];
}

async function makePrivate(db: Client, id: string) {
  await db.queryArray`update projects set is_private = true where id = ${id}`;
}

Deno.test("закрытый чужой проект для привязки не виден, свой и открытый — видны", async () => {
  const db = await connect();
  try {
    await seed(db);
    const open = await project(db, WS, "Открытый", AUTHOR);
    const closed = await project(db, WS, "Закрытый", AUTHOR);
    await makePrivate(db, closed.id);

    assertEquals(await canViewProjectInWorkspace(open.id, WS, MEMBER), true);
    assertEquals(await canViewProjectInWorkspace(closed.id, WS, MEMBER), false);
    assertEquals(await canViewProjectInWorkspace(closed.id, WS, AUTHOR), true);
    // Без личности вызывающего закрытая строка закрыта (fail-closed).
    assertEquals(
      await canViewProjectInWorkspace(closed.id, WS, undefined),
      false,
    );
  } finally {
    await db.end();
  }
});

Deno.test("подпроект закрытой группы закрыт для привязки, даже открытый сам по себе", async () => {
  const db = await connect();
  try {
    await seed(db);
    const group = await project(db, WS, "Группа", AUTHOR);
    const sub = await project(db, WS, "Подпроект", MEMBER, group.id);
    assertEquals(await canViewProjectInWorkspace(sub.id, WS, MEMBER), true);
    await makePrivate(db, group.id);
    assertEquals(await canViewProjectInWorkspace(sub.id, WS, MEMBER), false);
  } finally {
    await db.end();
  }
});

Deno.test("проект чужого воркспейса и архивный проект для привязки не видны", async () => {
  const db = await connect();
  try {
    await seed(db);
    const foreign = await project(db, OTHER_WS, "Чужой", AUTHOR);
    assertEquals(await canViewProjectInWorkspace(foreign.id, WS, AUTHOR), false);

    const gone = await project(db, WS, "Архив", AUTHOR);
    await db
      .queryArray`update projects set archived_at = now() where id = ${gone.id}`;
    assertEquals(await canViewProjectInWorkspace(gone.id, WS, AUTHOR), false);
  } finally {
    await db.end();
  }
});
