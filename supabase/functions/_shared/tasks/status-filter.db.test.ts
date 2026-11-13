// Серверный фильтр статусов не меняет, КТО что видит (issue #111).
//
// Статус — ещё одно условие через И рядом с воркспейсом, архивом и видимостью проектов. Ошибка
// здесь не падает: лишний `or` или потерянный фильтр проекта молча покажет задачу закрытого
// проекта тому, кто её видеть не должен. Поэтому для КАЖДОГО фильтра сверяем: выдача с фильтром
// == выдача без фильтра, отобранная по статусу, — для автора закрытого проекта, участника и
// безымянного зрителя (fail-closed), а также в дельте веб-поллинга.
import { assert, assertEquals } from "@std/assert";
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

const { listTasksWithTotal } = await import("./db.ts");
const { TASK_STATUSES } = await import("./statuses.ts");

const WS = "t_statusfilter";
const AUTHOR = 880000301;
const MEMBER = 880000302;

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

/** По задаче на каждый статус — без проекта, в открытом и в закрытом (приватном) проекте. */
async function seed(db: Client): Promise<void> {
  await db.queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from project_history where project_id in (select id from projects where group_id = ${WS})`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.queryArray`insert into workspaces (id, name) values (${WS}, 'Фильтр статусов')`;
  const project = async (name: string, priv: boolean) =>
    (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private)
      values (${WS}, ${name}, ${AUTHOR}, ${priv}) returning id`).rows[0].id;
  const openP = await project("Открытый", false);
  const closedP = await project("Закрытый", true);
  for (const status of TASK_STATUSES) {
    for (const [where, projectId] of [["без проекта", null], ["открытый", openP], ["закрытый", closedP]] as const) {
      await db.queryArray`
        insert into tasks (title, status, group_id, project_id, created_by, confirmed)
        values (${`${status} / ${where}`}, ${status}, ${WS}, ${projectId}, 'test', true)`;
    }
  }
  // Архивная задача не видна ни с фильтром, ни без.
  await db.queryArray`
    insert into tasks (title, status, group_id, created_by, confirmed, archived_at)
    values ('archived', 'open', ${WS}, 'test', true, now())`;
}

const titles = (r: { tasks: Array<{ title: string }> }) => r.tasks.map((t) => t.title).sort();
const COLS = "id, title, status, archived_at, updated_at";

const filters: Array<readonly string[]> = [
  ...TASK_STATUSES.map((s) => [s]),
  ["open", "in_progress", "backlog"],
  ["done", "cancelled"],
];

Deno.test("statuses: те же строки, что и без фильтра, для каждого зрителя и каждого набора статусов", async () => {
  const db = await connect();
  try {
    await seed(db);
    for (const viewerId of [AUTHOR, MEMBER, undefined]) {
      // Эталон: все подтверждённые (так ходит веб), отобранные по статусу уже здесь.
      const all = await listTasksWithTotal({ viewerId, confirmed: true, columns: COLS }, WS);
      assert(all.tasks.length > 0);
      for (const statuses of filters) {
        const expected = all.tasks
          .filter((t) => statuses.includes((t as unknown as { status: string }).status))
          .map((t) => t.title).sort();
        const got = await listTasksWithTotal({ viewerId, confirmed: true, statuses, columns: COLS }, WS);
        assertEquals(titles(got), expected, `viewer=${viewerId} statuses=${statuses}`);
        assertEquals(got.total, expected.length);
      }
    }
  } finally {
    await db.end();
  }
});

Deno.test("statuses: задачи закрытого проекта по-прежнему только у автора, архивные — ни у кого", async () => {
  const db = await connect();
  try {
    await seed(db);
    const open = ["open", "in_progress", "backlog"];
    const member = await listTasksWithTotal({ viewerId: MEMBER, statuses: open, confirmed: true }, WS);
    assert(!titles(member).some((t) => t.endsWith("закрытый") || t === "archived"));
    assertEquals(member.tasks.length, 6);
    const author = await listTasksWithTotal({ viewerId: AUTHOR, statuses: open, confirmed: true }, WS);
    assertEquals(author.tasks.length, 9);
    assert(titles(author).includes("open / закрытый"));
    const nobody = await listTasksWithTotal({ statuses: open, confirmed: true }, WS);
    assertEquals(nobody.tasks.length, 6);
  } finally {
    await db.end();
  }
});

Deno.test("statuses: дельта веб-поллинга со статусами тоже не отдаёт закрытый проект", async () => {
  const db = await connect();
  try {
    await seed(db);
    const since = new Date(Date.now() - 60_000).toISOString();
    const member = await listTasksWithTotal({
      viewerId: MEMBER,
      updatedAfter: since,
      statuses: ["done"],
      columns: COLS,
    }, WS);
    assertEquals(titles(member), ["done / без проекта", "done / открытый"]);
  } finally {
    await db.end();
  }
});

Deno.test("statuses: без списка поведение прежнее — закрытые прячутся по умолчанию", async () => {
  const db = await connect();
  try {
    await seed(db);
    const r = await listTasksWithTotal({ viewerId: AUTHOR }, WS);
    assert(!titles(r).some((t) => t.startsWith("done") || t.startsWith("cancelled")));
  } finally {
    await db.end();
  }
});
