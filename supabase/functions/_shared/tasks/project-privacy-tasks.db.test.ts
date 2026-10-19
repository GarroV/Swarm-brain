// Закрытый проект прячет свои задачи, а закрыть/открыть проект могут только автор и админ —
// на НАСТОЯЩЕЙ базе (решение владельца 16.10.2026, docs/decisions/2026-10-16-security-fixes.md).
//
// Почему на базе: правило видимости — чистый canViewProject, а ломается здесь другое: фильтр
// выборки задач (PostgREST `or`), дельта веб-поллинга со своим `or`, поштучное чтение и условие
// в WHERE у правки проекта. Ошибка в любом из них не падает — задача просто показывается.
import { assert, assertEquals, assertRejects } from "@std/assert";
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

const { getVisibleTask, listTasksWithTotal } = await import("./db.ts");
const { createProject, deleteProject, getVisibleProject, ProjectAccessError, updateProject } = await import(
  "./projects.ts"
);
const { loadHiddenProjectIds } = await import("./project-visibility.ts");

const WS = "t_pprivacy";
const AUTHOR = 880000201;
const MEMBER = 880000202;

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

type Seeded = {
  open: string;
  closed: string;
  subOfClosed: string;
  tOpen: string;
  tClosed: string;
  tSub: string;
  tNone: string;
};

async function seed(db: Client): Promise<Seeded> {
  await db
    .queryArray`delete from project_history where project_id in (select id from projects where group_id = ${WS})`;
  await db
    .queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db
    .queryArray`update projects set parent_id = null where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db
    .queryArray`insert into workspaces (id, name) values (${WS}, 'Приватность')`;

  const project = async (
    name: string,
    priv: boolean,
    parent: string | null = null,
  ) =>
    (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private, parent_id)
      values (${WS}, ${name}, ${AUTHOR}, ${priv}, ${parent}) returning id`)
      .rows[0].id;
  const task = async (title: string, projectId: string | null) =>
    (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by, confirmed)
      values (${title}, 'open', ${WS}, ${projectId}, 'test', true) returning id`)
      .rows[0].id;

  const open = await project("Открытый", false);
  const closed = await project("Закрытый", true);
  const subOfClosed = await project("Подпроект закрытого", false, closed);
  return {
    open,
    closed,
    subOfClosed,
    tOpen: await task("в открытом", open),
    tClosed: await task("в закрытом", closed),
    tSub: await task("в подпроекте закрытого", subOfClosed),
    tNone: await task("без проекта", null),
  };
}

const titles = (tasks: Array<{ title: string }>) => tasks.map((t) => t.title).sort();

Deno.test("список задач: задачи закрытого проекта видит только тот, кто видит проект", async () => {
  const db = await connect();
  try {
    await seed(db);
    const member = await listTasksWithTotal({ viewerId: MEMBER }, WS);
    assertEquals(titles(member.tasks), ["без проекта", "в открытом"]);
    assertEquals(member.total, 2);

    const author = await listTasksWithTotal({ viewerId: AUTHOR }, WS);
    assertEquals(titles(author.tasks), [
      "без проекта",
      "в закрытом",
      "в открытом",
      "в подпроекте закрытого",
    ]);

    // Без зрителя закрытое скрыто целиком (fail-closed).
    const nobody = await listTasksWithTotal({}, WS);
    assertEquals(titles(nobody.tasks), ["без проекта", "в открытом"]);
  } finally {
    await db.end();
  }
});

Deno.test("дельта веб-поллинга тоже не отдаёт задачи закрытого проекта", async () => {
  const db = await connect();
  try {
    await seed(db);
    const since = new Date(Date.now() - 60_000).toISOString();
    const member = await listTasksWithTotal({
      viewerId: MEMBER,
      updatedAfter: since,
      columns: "id, title, archived_at, updated_at",
    }, WS);
    assertEquals(titles(member.tasks), ["без проекта", "в открытом"]);

    // Условие дельты не потерялось рядом с условием видимости: два `or` складываются через И.
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const none = await listTasksWithTotal({
      viewerId: MEMBER,
      updatedAfter: future,
      columns: "id, title, archived_at, updated_at",
    }, WS);
    assertEquals(none.tasks, []);
  } finally {
    await db.end();
  }
});

Deno.test("поштучное чтение: задача закрытого проекта для чужого — как несуществующая", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    assertEquals(await getVisibleTask(s.tClosed, MEMBER), null);
    assertEquals(await getVisibleTask(s.tSub, MEMBER), null);
    assert(await getVisibleTask(s.tOpen, MEMBER));
    assert(await getVisibleTask(s.tNone, MEMBER));
    assert(await getVisibleTask(s.tClosed, AUTHOR));
  } finally {
    await db.end();
  }
});

Deno.test("тумблер приватности: участник не закрывает чужой проект, автор и админ — да", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    await assertRejects(
      () => updateProject(s.open, { is_private: true }, WS, { viewerId: MEMBER }),
      ProjectAccessError,
    );
    const row = await db.queryObject<{ is_private: boolean }>`
      select is_private from projects where id = ${s.open}`;
    assertEquals(row.rows[0].is_private, false);

    // Остальные правки открытого проекта участнику по-прежнему доступны (решение 2026-07-01).
    const renamed = await updateProject(s.open, { name: "Переименован" }, WS, {
      viewerId: MEMBER,
    });
    assertEquals(renamed?.name, "Переименован");
    // Тот же is_private, что уже стоит, — не переключение, правку не роняет.
    assert(
      await updateProject(s.open, { name: "Ещё раз", is_private: false }, WS, {
        viewerId: MEMBER,
      }),
    );

    const byAdmin = await updateProject(s.open, { is_private: true }, WS, {
      viewerId: MEMBER,
      isAdmin: true,
    });
    assertEquals(byAdmin?.is_private, true);
    const byAuthor = await updateProject(s.open, { is_private: false }, WS, {
      viewerId: AUTHOR,
    });
    assertEquals(byAuthor?.is_private, false);
  } finally {
    await db.end();
  }
});

Deno.test("перенос под закрытую группу — тоже закрытие: участнику нельзя, автору можно", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    // Своя закрытая группа участника: перенос туда чужого открытого проекта спрятал бы его у всех.
    const mine = (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private)
      values (${WS}, 'Моя закрытая', ${MEMBER}, true) returning id`).rows[0].id;
    await assertRejects(
      () => updateProject(s.open, { parent_id: mine }, WS, { viewerId: MEMBER }),
      ProjectAccessError,
    );
    const row = await db.queryObject<{ parent_id: string | null }>`
      select parent_id from projects where id = ${s.open}`;
    assertEquals(row.rows[0].parent_id, null);

    // Под группу, которую зритель не видит, переносить нельзя вовсе.
    await assertRejects(
      () => updateProject(s.open, { parent_id: s.closed }, WS, { viewerId: MEMBER }),
      Error,
      "parent_id не найден",
    );

    // Автор своего проекта переносит его под свою закрытую группу.
    const moved = await updateProject(s.open, { parent_id: s.closed }, WS, { viewerId: AUTHOR });
    assertEquals(moved?.parent_id, s.closed);
  } finally {
    await db.end();
  }
});

Deno.test("проект без автора закрыть может только админ", async () => {
  const db = await connect();
  try {
    await seed(db);
    const orphan = (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private)
      values (${WS}, 'Ничейный', null, false) returning id`).rows[0].id;
    await assertRejects(
      () => updateProject(orphan, { is_private: true }, WS, { viewerId: MEMBER }),
      ProjectAccessError,
    );
    const byAdmin = await updateProject(orphan, { is_private: true }, WS, { viewerId: MEMBER, isAdmin: true });
    assertEquals(byAdmin?.is_private, true);
    // Закрывший становится автором: иначе строка без автора осталась бы видна всем, и закрытие
    // ничего бы не закрыло.
    assertEquals(byAdmin?.created_by, MEMBER);
    assert((await loadHiddenProjectIds(WS, AUTHOR)).includes(orphan));
  } finally {
    await db.end();
  }
});

Deno.test("подпроект нельзя создать под группой, которую создающий не видит", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    await assertRejects(
      () => createProject({ name: "Внутрь чужой", parent_id: s.closed }, WS, MEMBER),
      Error,
      "parent_id не найден",
    );
  } finally {
    await db.end();
  }
});

Deno.test("задача с проектом вне воркспейса не видна — ни списком, ни поштучно", async () => {
  const db = await connect();
  try {
    await seed(db);
    const OTHER = "t_pprivacy_other";
    await db.queryArray`delete from tasks where group_id = ${OTHER}`;
    await db.queryArray`delete from projects where group_id = ${OTHER}`;
    await db.queryArray`delete from workspaces where id = ${OTHER}`;
    await db.queryArray`insert into workspaces (id, name) values (${OTHER}, 'Чужой')`;
    const foreign = (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private)
      values (${OTHER}, 'Чужой закрытый', ${AUTHOR}, true) returning id`).rows[0].id;
    const stray = (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by, confirmed)
      values ('сбитая ссылка', 'open', ${WS}, ${foreign}, 'test', true) returning id`).rows[0].id;

    const member = await listTasksWithTotal({ viewerId: MEMBER, columns: "id, title, project_id" }, WS);
    assertEquals(titles(member.tasks), ["без проекта", "в открытом"]);
    assertEquals(await getVisibleTask(stray, MEMBER), null);
  } finally {
    await db.end();
  }
});

Deno.test("закрытый проект без автора не создаётся", async () => {
  const db = await connect();
  try {
    await seed(db);
    await assertRejects(() => createProject({ name: "Ничей закрытый", is_private: true }, WS, null), Error, "автор");
  } finally {
    await db.end();
  }
});

Deno.test("архив группы не уносит чужой закрытый подпроект, которого архивирующий не видит", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    const OTHER_AUTHOR = 880000203;
    const hiddenKid = (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private, parent_id)
      values (${WS}, 'Чужой закрытый подпроект', ${OTHER_AUTHOR}, true, ${s.open}) returning id`).rows[0].id;
    await assertRejects(() => deleteProject(s.open, WS, { viewerId: MEMBER }), ProjectAccessError);
    const rows = await db.queryObject<{ id: string; archived_at: string | null }>`
      select id, archived_at from projects where id in (${s.open}, ${hiddenKid})`;
    assert(rows.rows.every((r) => r.archived_at === null));
    // Автор подпроекта видит всё поддерево — и группу убрать может.
    assert(await deleteProject(s.open, WS, { viewerId: OTHER_AUTHOR }));
  } finally {
    await db.end();
  }
});

Deno.test("getVisibleProject: чужой закрытый проект — как несуществующий", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    assertEquals(await getVisibleProject(s.closed, WS, MEMBER), null);
    assertEquals(await getVisibleProject(s.subOfClosed, WS, MEMBER), null);
    assert(await getVisibleProject(s.open, WS, MEMBER));
    assert(await getVisibleProject(s.closed, WS, AUTHOR));
  } finally {
    await db.end();
  }
});

Deno.test("правка невидимого проекта отвечает как «не найден» — до проверки родителя", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    // Сам на себя родителем — validateParent отказал бы своим текстом и тем выдал бы, что
    // проект существует. Для невидимого id ответ обязан совпадать с несуществующим.
    assertEquals(await updateProject(s.closed, { parent_id: s.closed }, WS, { viewerId: MEMBER }), null);
    assertEquals(await updateProject(s.subOfClosed, { parent_id: s.open }, WS, { viewerId: MEMBER }), null);
    assertEquals(
      await updateProject(crypto.randomUUID(), { parent_id: s.open }, WS, { viewerId: MEMBER }),
      null,
    );
    const row = await db.queryObject<{ parent_id: string | null }>`
      select parent_id from projects where id = ${s.subOfClosed}`;
    assertEquals(row.rows[0].parent_id, s.closed);
  } finally {
    await db.end();
  }
});
