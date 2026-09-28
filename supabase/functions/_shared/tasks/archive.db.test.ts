// Архивация вместо удаления — на НАСТОЯЩЕЙ базе (локальный контур `supabase start`).
//
// Почему именно здесь и именно так. Всё, ради чего писалась архивация, живёт в базе, а не в
// коде: связи `on delete set null`, каскады, частичный уникальный индекс живого спринта. Мок
// проверил бы мою модель базы, а не базу — а поймать надо ровно то, что уже случилось на проде:
// снос пространства молча вынес из него ВСЕ проекты, и раздел опустел у всей команды.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять. Пропуск по
// причине «нет окружения» — это непроверенная проверка, которая выглядит зелёной.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Модули поднимают клиента на уровне файла из env, поэтому env выставляется ДО импорта, а сам
// импорт — динамический. Статический сработал бы раньше присваивания и ушёл бы в пустой URL.
Deno.env.set(
  "SUPABASE_URL",
  Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321",
);
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

const { deleteProject, listProjects } = await import("./projects.ts");
const { deleteTask, getTask, listTasksWithTotal } = await import("./db.ts");
const { createSprint, deleteSprint, listSprints } = await import(
  "./sprints.ts"
);
const { createCycle, deleteCycle, listCycles } = await import(
  "./sprint-cycles.ts"
);

const WS = "t_archive";
const ACTOR = 424242;

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

/** Чистое место перед каждым тестом: чужие остатки — самый частый источник ложного зелёного. */
async function seed(db: Client) {
  await db.queryArray`delete from sprint_cycles where group_id = ${WS}`;
  await db
    .queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from sprints where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db
    .queryArray`insert into workspaces (id, name) values (${WS}, 'Тестовый')`;
}

async function addProject(
  db: Client,
  name: string,
  opts: { parentId?: string; sprintId?: string } = {},
) {
  const r = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name, parent_id, sprint_id)
    values (${WS}, ${name}, ${opts.parentId ?? null}, ${opts.sprintId ?? null})
    returning id`;
  return r.rows[0].id;
}

async function addTask(db: Client, title: string, projectId?: string) {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by)
    values (${title}, 'open', ${WS}, ${projectId ?? null}, 'test')
    returning id`;
  return r.rows[0].id;
}

Deno.test("проект: архивируется вместе с подпроектами, задачи остаются привязанными", async () => {
  const db = await connect();
  try {
    await seed(db);
    const groupId = await addProject(db, "Группа");
    const childId = await addProject(db, "Подпроект", { parentId: groupId });
    const taskId = await addTask(db, "Задача группы", groupId);

    assert(await deleteProject(groupId, WS, { viewerId: ACTOR }));

    // 1. Из интерфейса ушло всё поддерево — человек видит ровно то же, что видел при удалении.
    const visible = await listProjects(WS, { viewerId: ACTOR });
    assertEquals(visible.map((p) => p.id), []);

    // 2. Но строки на месте, с отметкой кто и когда.
    const rows = await db.queryObject<
      { id: string; archived_at: Date | null; archived_by: string | null }
    >`select id, archived_at, archived_by from projects where group_id = ${WS}`;
    assertEquals(rows.rows.length, 2);
    for (const id of [groupId, childId]) {
      const r = rows.rows.find((x) => x.id === id);
      assert(r, `строка ${id} исчезла из базы — это удаление, а не архивация`);
      assert(r.archived_at !== null, `${id} не помечен архивным`);
      assertEquals(Number(r.archived_by), ACTOR);
    }

    // 3. Главное: связь задачи с проектом НЕ разорвана — иначе восстанавливать будет нечего.
    const t = await db.queryObject<{ project_id: string | null }>`
      select project_id from tasks where id = ${taskId}`;
    assertEquals(t.rows[0].project_id, groupId);
  } finally {
    await db.end();
  }
});

Deno.test("пространство: архивация НЕ выкидывает из него проекты", async () => {
  const db = await connect();
  try {
    await seed(db);
    const space = await createSprint(
      {
        name: "Пространство",
        start_date: "2026-09-01",
        end_date: "2026-09-30",
        kind: "board_tab",
      },
      WS,
    );
    const projectId = await addProject(db, "Проект в пространстве", {
      sprintId: space.id,
    });

    assert(await deleteSprint(space.id, WS, ACTOR));

    // Пространство исчезло из списка...
    assertEquals(await listSprints(WS, "board_tab"), []);

    // ...а проект остался и ПОМНИТ своё пространство. До 21.09.2026 здесь стоял DELETE, и
    // `on delete set null` обнулял sprint_id у всех проектов разом — та самая потеря раскладки.
    const visible = await listProjects(WS, { viewerId: ACTOR });
    assertEquals(visible.map((p) => p.id), [projectId]);
    const row = await db.queryObject<{ sprint_id: string | null }>`
      select sprint_id from projects where id = ${projectId}`;
    assertEquals(row.rows[0].sprint_id, space.id);
  } finally {
    await db.end();
  }
});

Deno.test("задача: архивируется, история изменений переживает архивацию", async () => {
  const db = await connect();
  try {
    await seed(db);
    const taskId = await addTask(db, "Задача с историей");
    await db.queryArray`
      insert into task_history (task_id, changed_by, field, old_value, new_value, group_id)
      values (${taskId}, 'tester', 'status', 'open', 'in_progress', ${WS})`;

    await deleteTask(taskId, ACTOR);

    // Для приложения задачи больше нет — ни поштучно, ни в списке.
    assertEquals(await getTask(taskId), null);
    const { tasks, total } = await listTasksWithTotal({}, WS);
    assertEquals(tasks.map((t) => t.id), []);
    assertEquals(total, 0);

    // Но и строка, и журнал целы. Раньше `deleteTask` первым делом сносил `task_history` —
    // журнал пропадал ровно в том случае, ради которого заводился: «кто убрал задачу».
    const row = await db.queryObject<
      { archived_at: Date | null; archived_by: string | null }
    >`select archived_at, archived_by from tasks where id = ${taskId}`;
    assert(row.rows[0]?.archived_at !== null);
    assertEquals(Number(row.rows[0].archived_by), ACTOR);
    const hist = await db.queryObject<
      { n: bigint }
    >`select count(*)::bigint as n from task_history where task_id = ${taskId}`;
    assertEquals(Number(hist.rows[0].n), 1);
  } finally {
    await db.end();
  }
});

Deno.test("спринт: архивный черновик освобождает место под новый в том же пространстве", async () => {
  const db = await connect();
  try {
    await seed(db);
    const space = await createSprint(
      {
        name: "Пространство спринтов",
        start_date: "2026-09-01",
        end_date: "2026-09-30",
        kind: "space",
      },
      WS,
    );
    const first = await createCycle(
      {
        tab_id: space.id,
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
      },
      WS,
      "tester",
    );

    assert(await deleteCycle(first.id, WS, ACTOR));
    assertEquals(await listCycles(WS, space.id), []);

    // Уникальный индекс «один незакрытый спринт на пространство» обязан считать только живые:
    // иначе архивный черновик навсегда занимает место, а человек упирается в «уже есть
    // незакрытый спринт», не видя его нигде.
    const second = await createCycle(
      {
        tab_id: space.id,
        name: "Спринт 2",
        start_date: "2026-09-15",
        end_date: "2026-09-28",
      },
      WS,
      "tester",
    );
    assertEquals((await listCycles(WS, space.id)).map((c) => c.id), [
      second.id,
    ]);

    // Архивный спринт остался строкой — с отметкой, кто его убрал.
    const row = await db.queryObject<{ archived_by: string | null }>`
      select archived_by from sprint_cycles where id = ${first.id}`;
    assertEquals(Number(row.rows[0].archived_by), ACTOR);
  } finally {
    await db.end();
  }
});
