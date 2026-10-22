// Данные доски спринтов на НАСТОЯЩЕЙ базе (контур, который выберет scripts/with-local-db).
//
// Чистую полоску спринтов проверяет sprint-board.test.ts. Здесь — то, что видно только на базе:
// мастер-план не отдаёт задачи закрытого проекта тому, кто его не видит, черновики и архивные
// задачи в план не попадают, принятый спринт приходит без состава, чужой воркспейс до доски не
// дотягивается. Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";
import { addDays } from "./sprint-dates.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) {
    throw new Error(
      `Не задана переменная ${name}. Подними локальный контур (supabase start) и прогоняй ` +
        `через ./scripts/with-local-db — он подставит доступы.`,
    );
  }
}

const { loadBoard } = await import("./sprint-board-load.ts");

const WS = "t_sboard";
const OTHER_WS = "t_sboard_x";
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

async function reset(db: Client) {
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from task_history where group_id = ${ws}`;
    await db
      .queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${ws})`;
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, 'Доска')`;
  }
}

interface Scene {
  tab: string;
  tab2: string;
  P: string;
  A: string;
  F: string;
  open: string;
  closed: string;
  tLive: string;
  tMoved: string;
  tClosed: string;
}

async function build(db: Client): Promise<Scene> {
  await reset(db);
  const today = (await db.queryObject<{ d: string }>`select current_date::text as d`).rows[0].d;
  const space = async (name: string) =>
    (await db.queryObject<{ id: string }>`
      insert into sprints (id, group_id, name, start_date, end_date, status, kind)
      values (gen_random_uuid(), ${WS}, ${name}, current_date, current_date + 30, 'active', 'space')
      returning id`).rows[0].id;
  const tab = await space("Пространство");
  const tab2 = await space("Другое");
  const cycle = async (name: string, start: string, end: string, status: string) =>
    (await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
      values (${WS}, ${tab}, ${name}, ${start}, ${end}, ${addDays(start, 6)}, ${status}) returning id`).rows[0].id;
  const P = await cycle("Спринт 3", addDays(today, -19), addDays(today, -6), "accepted");
  const A = await cycle("Спринт 4", addDays(today, -5), addDays(today, 8), "active");
  const F = await cycle("Спринт 5", addDays(today, 9), addDays(today, 22), "draft");

  const group = async (name: string, priv: boolean) =>
    (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private, sprint_group, sprint_id)
      values (${WS}, ${name}, ${AUTHOR}, ${priv}, true, ${tab}) returning id`).rows[0].id;
  const open = await group("Открытая группа", false);
  const closed = await group("Закрытая группа", true);

  const task = async (title: string, projectId: string, status = "open", archived = false) =>
    (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by, confirmed, archived_at)
      values (${title}, ${status}, ${WS}, ${projectId}, 'test', true, ${archived ? new Date().toISOString() : null})
      returning id`).rows[0].id;
  const tLive = await task("живая в двух спринтах", open);
  const tMoved = await task("перенесена из идущего", open);
  const tClosed = await task("в закрытой группе", closed);
  await task("архивная", open, "open", true);

  const place = async (cycleId: string, taskId: string, moved = false) =>
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan, moved_at)
      values (${cycleId}, ${taskId}, true, ${moved ? new Date().toISOString() : null})`;
  await place(P, tLive);
  await place(A, tLive);
  await place(F, tLive);
  await place(A, tMoved, true);
  await place(F, tMoved);
  await place(A, tClosed);
  return { tab, tab2, P, A, F, open, closed, tLive, tMoved, tClosed };
}

Deno.test("мастер-план: архивные задачи и закрытая группа не попадают к тому, кто её не видит", async () => {
  const db = await connect();
  try {
    const s = await build(db);
    const board = await loadBoard(WS, s.tab, MEMBER);
    assertEquals(board.plan.groups.map((g) => g.name), ["Открытая группа"]);
    const titles = board.plan.groups[0].tasks.map((t) => t.title).sort();
    assertEquals(titles, ["живая в двух спринтах", "перенесена из идущего"]);
  } finally {
    await db.end();
  }
});

Deno.test("автор закрытой группы видит её задачи и их спринты", async () => {
  const db = await connect();
  try {
    const s = await build(db);
    const board = await loadBoard(WS, s.tab, AUTHOR);
    assertEquals(board.plan.groups.map((g) => g.name).sort(), ["Закрытая группа", "Открытая группа"]);
    const closed = board.plan.groups.find((g) => g.id === s.closed)!;
    assertEquals(closed.tasks.map((t) => t.cycle_ids), [[s.A]]);
  } finally {
    await db.end();
  }
});

Deno.test("полоска спринтов: снимок переноса не считается, порядок по началу спринта", async () => {
  const db = await connect();
  try {
    const s = await build(db);
    const board = await loadBoard(WS, s.tab, MEMBER);
    const tasks = board.plan.groups[0].tasks;
    assertEquals(tasks.find((t) => t.id === s.tLive)!.cycle_ids, [s.P, s.A, s.F]);
    assertEquals(tasks.find((t) => t.id === s.tMoved)!.cycle_ids, [s.F]);
  } finally {
    await db.end();
  }
});

Deno.test("спринты слева направо; принятый — без состава, идущий — со снимком переноса", async () => {
  const db = await connect();
  try {
    const s = await build(db);
    const board = await loadBoard(WS, s.tab, MEMBER);
    assertEquals(board.cycles.map((c) => c.cycle.id), [s.P, s.A, s.F]);
    const [past, live] = board.cycles;
    assertEquals(past.loaded, false);
    assertEquals(past.items.length, 0);
    assert(live.loaded);
    assertEquals(live.moved.map((i) => i.task_id), [s.tMoved]);
  } finally {
    await db.end();
  }
});

Deno.test("чужое пространство и чужой воркспейс доску не наполняют", async () => {
  const db = await connect();
  try {
    const s = await build(db);
    const other = await loadBoard(WS, s.tab2, MEMBER);
    assertEquals(other.cycles.length, 0);
    assertEquals(other.plan.groups.length, 0);
    const foreign = await loadBoard(OTHER_WS, s.tab, MEMBER);
    assertEquals(foreign.cycles.length, 0);
    assertEquals(foreign.plan.groups.length, 0);
  } finally {
    await db.end();
  }
});
