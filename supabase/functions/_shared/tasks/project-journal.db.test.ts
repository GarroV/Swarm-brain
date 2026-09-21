// Перенос проекта между пространствами и журнал изменений — на НАСТОЯЩЕЙ базе (issue #426).
//
// Почему на базе: проверяется не форма строк (это делает project-history.test.ts), а то, что
// запись ДОХОДИТ и что переезд тащит поддерево. Молчаливо не записанное изменение неотличимо
// от «его не было», и выясняется это через месяц — на пустом журнале.
import { assert, assertEquals } from "@std/assert";
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

const { createProject, deleteProject, updateProject } = await import(
  "./projects.ts"
);
const { createSprint } = await import("./sprints.ts");

const WS = "t_pjournal";
const ACTOR = 555001;

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
  await db
    .queryArray`delete from project_history where project_id in (select id from projects where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from sprints where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db
    .queryArray`insert into workspaces (id, name) values (${WS}, 'Тестовый')`;
}

type JournalRow = {
  project_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  note: string | null;
};

const journal = (db: Client, projectId: string) =>
  db.queryObject<JournalRow>`
    select project_id, field, old_value, new_value, changed_by, note
      from project_history where project_id = ${projectId}
     order by created_at`.then((r) => r.rows);

const space = (name: string) =>
  createSprint(
    {
      name,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      kind: "board_tab",
    },
    WS,
  );

Deno.test("переезд в другое пространство уносит подпроекты и пишется в журнал", async () => {
  const db = await connect();
  try {
    await seed(db);
    const from = await space("Пространство А");
    const to = await space("Пространство Б");
    const parent = await createProject(
      { name: "Направление", sprint_id: from.id },
      WS,
      ACTOR,
    );
    const kid = await createProject(
      { name: "Подпроект", parent_id: parent.id, sprint_id: from.id },
      WS,
      ACTOR,
    );

    const moved = await updateProject(parent.id, { sprint_id: to.id }, WS, {
      viewerId: ACTOR,
    });
    assertEquals(moved?.sprint_id, to.id);

    // Главное: подпроект уехал вместе с родителем. Инвариант «подпроект живёт в пространстве
    // родителя» держится при создании и перетаскивании — переезд родителя его ломал, и увидеть
    // это глазом нельзя: доска рисует подпроекты ЧЕРЕЗ родителя.
    const kidRow = await db.queryObject<{ sprint_id: string | null }>`
      select sprint_id from projects where id = ${kid.id}`;
    assertEquals(kidRow.rows[0].sprint_id, to.id);

    const parentJournal = await journal(db, parent.id);
    assertEquals(parentJournal.map((r) => r.field), ["created", "space"]);
    assertEquals(parentJournal[1].old_value, from.id);
    assertEquals(parentJournal[1].new_value, to.id);
    assertEquals(parentJournal[1].changed_by, String(ACTOR));

    const kidJournal = await journal(db, kid.id);
    assertEquals(kidJournal.map((r) => r.field), ["created", "space"]);
    assertEquals(kidJournal[1].note, "вслед за родительским проектом");
  } finally {
    await db.end();
  }
});

Deno.test("правка без изменений журнал не засоряет", async () => {
  const db = await connect();
  try {
    await seed(db);
    const s = await space("Пространство");
    const p = await createProject(
      { name: "Проект", sprint_id: s.id },
      WS,
      ACTOR,
    );

    // Форма присылает весь объект целиком — журнал обязан промолчать, иначе в нём не найти
    // настоящее перемещение среди строк «было X, стало X».
    await updateProject(p.id, { name: "Проект", sprint_id: s.id }, WS, {
      viewerId: ACTOR,
    });

    assertEquals((await journal(db, p.id)).map((r) => r.field), ["created"]);
  } finally {
    await db.end();
  }
});

Deno.test("архивация пишется событием — и на проекте, и на подпроектах", async () => {
  const db = await connect();
  try {
    await seed(db);
    const s = await space("Пространство");
    const parent = await createProject(
      { name: "Направление", sprint_id: s.id },
      WS,
      ACTOR,
    );
    const kid = await createProject(
      { name: "Подпроект", parent_id: parent.id, sprint_id: s.id },
      WS,
      ACTOR,
    );

    assert(await deleteProject(parent.id, WS, { viewerId: ACTOR }));

    const parentJournal = await journal(db, parent.id);
    assertEquals(parentJournal.map((r) => r.field), ["created", "archived"]);
    assertEquals(parentJournal[1].new_value, "с подпроектами: 1");
    assertEquals(parentJournal[1].changed_by, String(ACTOR));

    const kidJournal = await journal(db, kid.id);
    assertEquals(kidJournal.map((r) => r.field), ["created", "archived"]);
    assertEquals(kidJournal[1].note, "вслед за родительским проектом");

    // Журнал переживает архивацию: он и нужен для ответа «кто убрал проект».
    const alive = await db.queryObject<{ n: bigint }>`
      select count(*)::bigint as n from project_history
       where project_id in (${parent.id}, ${kid.id})`;
    assertEquals(Number(alive.rows[0].n), 4);
  } finally {
    await db.end();
  }
});
