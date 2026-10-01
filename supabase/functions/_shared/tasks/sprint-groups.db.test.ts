// Группы спринта на НАСТОЯЩЕЙ базе (решение 01.10.2026, docs/decisions/2026-10-01-sprint-drag-grouping.md).
//
// Чистое правило видимости проверяет sprint-groups.test.ts. Здесь — то, что видно только на базе:
// выборка доски действительно не отдаёт группу, «В проекты» её возвращает, чужой воркспейс до
// группы не дотягивается, а «Распустить» не теряет ни одной задачи и архивирует, а не удаляет.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

Deno.env.set(
  "SUPABASE_URL",
  Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321",
);
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

const { createProject, dissolveSprintGroup, listProjects, updateProject } = await import("./projects.ts");

const WS = "t_sgroups";
const OTHER = "t_sgroups_other";
const ACTOR = 555101;

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
  for (const ws of [WS, OTHER]) {
    await db
      .queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${ws})`;
    await db
      .queryArray`delete from project_history where project_id in (select id from projects where group_id = ${ws})`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db
      .queryArray`insert into workspaces (id, name) values (${ws}, 'Тестовый')`;
  }
}

async function addTask(db: Client, title: string, projectId: string | null) {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by)
    values (${title}, 'open', ${WS}, ${projectId}, 'test')
    returning id`;
  return r.rows[0].id;
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

Deno.test("группа спринта: на доске её нет, «В проекты» возвращает", async () => {
  const db = await connect();
  try {
    await seed(db);
    const parent = await createProject({ name: "Направление" }, WS, ACTOR);
    const group = await createProject(
      { name: "Связка", parent_id: parent.id, sprint_group: true },
      WS,
      ACTOR,
    );
    assertEquals(group.sprint_group, true);

    // Доска «Проекты», селектор карточки — выборка по умолчанию.
    const board = await listProjects(WS, { viewerId: ACTOR });
    assertEquals(ids(board), [parent.id]);
    // Экран спринта просит группы явно.
    const sprint = await listProjects(WS, {
      viewerId: ACTOR,
      withSprintGroups: true,
    });
    assertEquals(ids(sprint), ids([parent, group]));

    await updateProject(group.id, { sprint_group: false }, WS, {
      viewerId: ACTOR,
    });
    const after = await listProjects(WS, { viewerId: ACTOR });
    assertEquals(ids(after), ids([parent, group]));
  } finally {
    await db.end();
  }
});

Deno.test("группа спринта: признак не ставится существующему проекту и группа не родитель", async () => {
  const db = await connect();
  try {
    await seed(db);
    const plain = await createProject({ name: "Обычный" }, WS, ACTOR);
    await assertRejects(() => updateProject(plain.id, { sprint_group: true }, WS, { viewerId: ACTOR }));
    const group = await createProject(
      { name: "Группа", sprint_group: true },
      WS,
      ACTOR,
    );
    await assertRejects(() => createProject({ name: "Внутрь", parent_id: group.id }, WS, ACTOR));
  } finally {
    await db.end();
  }
});

Deno.test("распустить: чужой воркспейс и обычный проект — отказ (404)", async () => {
  const db = await connect();
  try {
    await seed(db);
    const group = await createProject(
      { name: "Группа", sprint_group: true },
      WS,
      ACTOR,
    );
    const plain = await createProject({ name: "Обычный" }, WS, ACTOR);
    const task = await addTask(db, "в группе", group.id);

    assertEquals(
      await dissolveSprintGroup(group.id, OTHER, { viewerId: ACTOR }),
      null,
    );
    assertEquals(
      await dissolveSprintGroup(plain.id, WS, { viewerId: ACTOR }),
      null,
    );
    // Ничего не тронуто: группа жива, задача на месте.
    const g = await db.queryObject<{ archived_at: string | null }>`
      select archived_at from projects where id = ${group.id}`;
    assertEquals(g.rows[0].archived_at, null);
    const t = await db.queryObject<{ project_id: string | null }>`
      select project_id from tasks where id = ${task}`;
    assertEquals(t.rows[0].project_id, group.id);
  } finally {
    await db.end();
  }
});

Deno.test("распустить: задачи уходят в родителя, ни одна не потеряна, группа в архиве", async () => {
  const db = await connect();
  try {
    await seed(db);
    const parent = await createProject({ name: "Направление" }, WS, ACTOR);
    const group = await createProject(
      { name: "Связка", parent_id: parent.id, sprint_group: true },
      WS,
      ACTOR,
    );
    const a = await addTask(db, "первая", group.id);
    const b = await addTask(db, "вторая", group.id);
    const loose = await createProject(
      { name: "Без проекта", sprint_group: true },
      WS,
      ACTOR,
    );
    const c = await addTask(db, "третья", loose.id);

    assertEquals(
      await dissolveSprintGroup(group.id, WS, { viewerId: ACTOR }),
      { moved: 2 },
    );
    assertEquals(
      await dissolveSprintGroup(loose.id, WS, { viewerId: ACTOR }),
      { moved: 1 },
    );

    const tasks = await db.queryObject<
      { id: string; project_id: string | null; archived_at: string | null }
    >`select id, project_id, archived_at from tasks where group_id = ${WS} order by title`;
    assertEquals(tasks.rows.length, 3);
    const byId = new Map(tasks.rows.map((r) => [r.id, r]));
    assertEquals(byId.get(a)?.project_id, parent.id);
    assertEquals(byId.get(b)?.project_id, parent.id);
    assertEquals(byId.get(c)?.project_id, null);
    assert(tasks.rows.every((r) => r.archived_at === null));

    // Группа не удалена — строка на месте, с отметкой архива.
    const groups = await db.queryObject<{ archived_at: string | null }>`
      select archived_at from projects where id in (${group.id}, ${loose.id})`;
    assertEquals(groups.rows.length, 2);
    assert(groups.rows.every((r) => r.archived_at !== null));
  } finally {
    await db.end();
  }
});
