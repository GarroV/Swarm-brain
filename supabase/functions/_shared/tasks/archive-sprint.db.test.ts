// Архивная задача и спринт на НАСТОЯЩЕЙ базе (issue #575). Правило живёт в триггере и в
// функции приёмки, поэтому и проверяется базой, а не моком. Тест не пропускается: базы нет —
// прогон падает (см. sprint-accept.db.test.ts).
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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

const WS = "t_archive575";

/** Каждый тест начинает с чистого места: чужие остатки — самый частый источник ложного зелёного. */
async function seed(db: Client) {
  await db.queryArray`delete from sprint_cycles where group_id = ${WS}`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from sprints where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db
    .queryArray`insert into workspaces (id, name) values (${WS}, 'Тестовый')`;

  const tab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active', 'space')
    returning id`;
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
  return { tabId: tab.rows[0].id, projectId: project.rows[0].id };
}

async function addTask(
  db: Client,
  projectId: string,
  status: string,
  title: string,
) {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by)
    values (${title}, ${status}, ${WS}, ${projectId}, 'test')
    returning id`;
  return r.rows[0].id;
}

async function startCycle(
  db: Client,
  tabId: string,
  name = "Спринт 1 · 01.09 — 14.09",
) {
  const r = await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (${WS}, ${tabId}, ${name}, current_date - 13, current_date, current_date - 7, 'active')
    returning id`;
  return r.rows[0].id;
}

async function addItem(
  db: Client,
  cycleId: string,
  taskId: string,
  toCarry = false,
) {
  const r = await db.queryObject<{ id: string }>`
    insert into sprint_items (cycle_id, task_id, in_plan, to_carry)
    values (${cycleId}, ${taskId}, true, ${toCarry}) returning id`;
  return r.rows[0].id;
}

const accept = (db: Client, cycleId: string) =>
  db.queryObject<{ result: Record<string, unknown> }>`
    select public.accept_sprint_cycle(
      ${cycleId}::uuid, ${WS}, 'tester', null, '{}'::jsonb,
      'Спринт 2 · 15.09 — 28.09', (current_date + 1)::date, (current_date + 14)::date, (current_date + 7)::date
    ) as result`;

const archive = (db: Client, taskId: string) =>
  db.queryArray`update tasks set archived_at = now(), archived_by = 1 where id = ${taskId}`;

type ItemRow = {
  task_id: string | null;
  removed_title: string | null;
  removed_at: Date | null;
};
const itemOf = async (db: Client, cycleId: string) =>
  (await db.queryObject<ItemRow>`
    select task_id, removed_title, removed_at from sprint_items where cycle_id = ${cycleId}`).rows;

Deno.test("архивация задачи превращает её строку в спринте в упоминание, связь цела", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "open", "убрана в архив");
    await addItem(db, cycleId, taskId);

    await archive(db, taskId);

    const rows = await itemOf(db, cycleId);
    assertEquals(rows.length, 1, "строка состава пропала");
    assert(rows[0].removed_at instanceof Date, "архивная задача осталась в спринте живой");
    assertEquals(rows[0].removed_title, "убрана в архив");
    assertEquals(rows[0].task_id, taskId, "связь с задачей рвать нельзя — иначе её не вернуть");
  } finally {
    await db.end();
  }
});

Deno.test("архивная задача при приёмке в следующий спринт не едет, даже с пометкой", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const gone = await addTask(db, projectId, "in_progress", "в архиве");
    const alive = await addTask(db, projectId, "open", "живая");
    await addItem(db, cycleId, gone, true);
    await addItem(db, cycleId, alive);
    await archive(db, gone);

    const res = await accept(db, cycleId);
    const out = res.rows[0].result as Record<string, unknown>;
    const moved = await db.queryObject<{ task_id: string }>`
      select task_id from sprint_items where cycle_id = ${String(out.next_cycle_id)}`;
    assertEquals(
      moved.rows.map((r) => r.task_id),
      [alive],
      "архивная задача уехала в следующий спринт",
    );
  } finally {
    await db.end();
  }
});

Deno.test("возврат задачи из архива возвращает её в состав непринятого спринта", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "open", "вернётся");
    await addItem(db, cycleId, taskId);
    await archive(db, taskId);

    await db.queryArray`update tasks set archived_at = null, archived_by = null where id = ${taskId}`;

    const rows = await itemOf(db, cycleId);
    assertEquals(rows[0].removed_at, null, "вернувшаяся задача осталась упоминанием");
    assertEquals(rows[0].removed_title, null);
  } finally {
    await db.end();
  }
});

Deno.test("принятый спринт архивация задачи не переписывает", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "done", "сделана и в архиве");
    await addItem(db, cycleId, taskId);
    await accept(db, cycleId);

    await archive(db, taskId);

    const rows = await itemOf(db, cycleId);
    assertEquals(rows[0].removed_at, null, "архив принятого спринта не должен меняться");
  } finally {
    await db.end();
  }
});

Deno.test("перевзвод пинга очищает список тех, кому он уже дошёл", async () => {
  const db = await connect();
  try {
    const { projectId } = await seed(db);
    const taskId = await addTask(db, projectId, "open", "с пингом");
    await db.queryArray`
      update tasks set remind_date = current_date, ping_delivered_to = '{111}' where id = ${taskId}`;

    // Тик дописал ещё одного получателя — список не должен сбрасываться.
    await db.queryArray`update tasks set ping_delivered_to = '{111,333}' where id = ${taskId}`;
    let r = await db.queryObject<{ p: string[] }>`
      select ping_delivered_to::text[] as p from tasks where id = ${taskId}`;
    assertEquals(r.rows[0].p, ["111", "333"], "запись тика стёрла сама себя");

    // Пинг погашен, потом его передвинули — новым напоминанием получают все заново.
    await db.queryArray`update tasks set reminded_at = now() where id = ${taskId}`;
    await db.queryArray`
      update tasks set remind_date = current_date + 3, reminded_at = null where id = ${taskId}`;
    r = await db.queryObject<{ p: string[] }>`
      select ping_delivered_to::text[] as p from tasks where id = ${taskId}`;
    assertEquals(r.rows[0].p, [], "передвинутый пинг не придёт тем, кому дошёл старый");
  } finally {
    await db.end();
  }
});
