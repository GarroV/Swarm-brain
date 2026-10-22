// План работы задачи («Спринты задачи…») — на НАСТОЯЩЕЙ базе (контур, который выберет
// scripts/with-local-db). Правило живёт в функции базы `sprint_set_task_span`: непрерывный
// отрезок запланированных спринтов, недостающие строки добавляются, лишние в запланированных
// снимаются; идущий и принятые спринты она не трогает; выход за срок или продление из идущего —
// только с причиной. Срок задачи функция не меняет никогда.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";
import { addDays } from "./sprint-dates.ts";

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

const WS = "t_sprint_span";
const OTHER_WS = "t_sprint_span_x";
const ME = "777101";

async function reset(db: Client) {
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from task_history where group_id = ${ws}`;
    await db.queryArray`delete from notifications where group_id = ${ws}`;
    await db.queryArray`delete from task_comments where task_id in (select id from tasks where group_id = ${ws})`;
    await db
      .queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${ws})`;
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
    await db.queryArray`delete from allowed_users where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, 'Тестовый')`;
  }
}

interface Scene {
  today: string;
  tabId: string;
  projectId: string;
  /** A — идущий (сегодня внутри), F1/F2 — запланированные, P — принятый прошлый. */
  A: string;
  F1: string;
  F2: string;
  P: string;
  /** Запланированный спринт другого пространства того же воркспейса. */
  otherTab: string;
}

async function space(db: Client, ws: string, name: string): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${ws}, ${name}, current_date, current_date + 30, 'active', 'space')
    returning id`;
  return r.rows[0].id;
}

async function cycle(
  db: Client,
  ws: string,
  tabId: string,
  name: string,
  start: string,
  end: string,
  status: string,
): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (${ws}, ${tabId}, ${name}, ${start}, ${end}, ${addDays(start, 6)}, ${status})
    returning id`;
  return r.rows[0].id;
}

async function build(db: Client): Promise<Scene> {
  await reset(db);
  const t = (await db.queryObject<{ d: string }>`select current_date::text as d`).rows[0].d;
  const tabId = await space(db, WS, "Пространство");
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
  const P = await cycle(db, WS, tabId, "Спринт 3", addDays(t, -19), addDays(t, -6), "accepted");
  const A = await cycle(db, WS, tabId, "Спринт 4", addDays(t, -5), addDays(t, 8), "active");
  const F1 = await cycle(db, WS, tabId, "Спринт 5", addDays(t, 9), addDays(t, 22), "draft");
  const F2 = await cycle(db, WS, tabId, "Спринт 6", addDays(t, 23), addDays(t, 36), "draft");
  const tab2 = await space(db, WS, "Другое пространство");
  const otherTab = await cycle(db, WS, tab2, "Чужой 5", addDays(t, 9), addDays(t, 22), "draft");
  return { today: t, tabId, projectId: project.rows[0].id, A, F1, F2, P, otherTab };
}

async function addTask(
  db: Client,
  s: Scene,
  opts: { status?: string; due?: string | null; isPrivate?: boolean; archived?: boolean } = {},
): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by, due_date, is_private, archived_at)
    values ('задача про юристов', ${opts.status ?? "open"}, ${WS}, ${s.projectId}, 'test',
            ${opts.due ?? null}, ${opts.isPrivate ?? false}, ${opts.archived ? new Date().toISOString() : null})
    returning id`;
  return r.rows[0].id;
}

async function place(db: Client, cycleId: string, taskId: string, carryCount = 0): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into sprint_items (cycle_id, task_id, in_plan, carry_count)
    values (${cycleId}, ${taskId}, true, ${carryCount}) returning id`;
  return r.rows[0].id;
}

interface SpanResult {
  added: string[];
  removed: string[];
}

function span(db: Client, s: Scene, taskId: string, from: string, to: string, reason: string | null = null) {
  return db.queryObject<{ r: SpanResult }>`
    select public.sprint_set_task_span(
      ${taskId}::uuid, ${s.tabId}::uuid, ${WS}, ${from}::uuid, ${to}::uuid, ${reason}, ${ME}) as r`;
}

interface Row {
  cycle_id: string;
  in_plan: boolean;
  plan_reason: string | null;
  withdrawn_at: string | null;
}

async function rows(db: Client, taskId: string): Promise<Row[]> {
  return (await db.queryObject<Row>`
    select si.cycle_id, si.in_plan, si.plan_reason, si.withdrawn_at::text
      from sprint_items si join sprint_cycles c on c.id = si.cycle_id
     where si.task_id = ${taskId} order by c.start_date`).rows;
}

async function dueOf(db: Client, taskId: string): Promise<string | null> {
  return (await db.queryObject<{ d: string | null }>`select due_date::text as d from tasks where id = ${taskId}`)
    .rows[0].d;
}

async function withScene(fn: (db: Client, s: Scene) => Promise<void>) {
  const db = await connect();
  try {
    await fn(db, await build(db));
  } finally {
    await db.end();
  }
}

Deno.test("отрезок С5–С6 создаёт строки в обоих запланированных спринтах, срок не трогается", async () => {
  await withScene(async (db, s) => {
    const due = addDays(s.today, 30); // внутри С6
    const taskId = await addTask(db, s, { due });
    const r = (await span(db, s, taskId, s.F1, s.F2)).rows[0].r;

    const all = await rows(db, taskId);
    assertEquals(all.map((x) => x.cycle_id), [s.F1, s.F2]);
    assertEquals(all.every((x) => x.in_plan), true, "строки плана помечены in_plan");
    assertEquals(new Set(r.added), new Set([s.F1, s.F2]));
    assertEquals(r.removed, []);
    assertEquals(await dueOf(db, taskId), due, "срок задачи функция не меняет");
  });
});

Deno.test("повторное сохранение того же отрезка ничего не меняет", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 30) });
    await span(db, s, taskId, s.F1, s.F2);
    const r = (await span(db, s, taskId, s.F1, s.F2)).rows[0].r;
    assertEquals(r.added, []);
    assertEquals(r.removed, []);
    assertEquals((await rows(db, taskId)).length, 2);
  });
});

Deno.test("сужение снимает строку запланированного, идущий не трогает", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 30) });
    await place(db, s.A, taskId);
    await place(db, s.F1, taskId);
    await place(db, s.F2, taskId);

    const r = (await span(db, s, taskId, s.F1, s.F1)).rows[0].r;

    assertEquals(r.removed, [s.F2]);
    assertEquals((await rows(db, taskId)).map((x) => x.cycle_id), [s.A, s.F1], "идущий и выбранный остались");
  });
});

Deno.test("сужение не трогает снимок переноса и снятую строку идущего", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 12) });
    const src = await place(db, s.A, taskId);
    await db.queryArray`select public.sprint_move_task(${src}::uuid, ${s.F1}::uuid, 'ждём', null, ${ME})`;
    // Задача живёт в С5 (цель переноса); план сужаем до С6: С5 снимается, снимок в идущем остаётся.
    await span(db, s, taskId, s.F2, s.F2, "после срока");
    const all = await rows(db, taskId);
    assertEquals(all.map((x) => x.cycle_id), [s.A, s.F2]);
    const snap = await db.queryObject<{ moved_at: string | null }>`
      select moved_at::text from sprint_items where task_id = ${taskId} and cycle_id = ${s.A}`;
    assert(snap.rows[0].moved_at !== null, "снимок в идущем нетронут");
  });
});

Deno.test("конец отрезка после срока без причины — отказ, ничего не меняется", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 12) }); // внутри С5
    await assertRejects(
      () => span(db, s, taskId, s.F1, s.F2),
      Error,
      "Нужна причина: работа после срока",
    );
    assertEquals((await rows(db, taskId)).length, 0);
    for (const reason of ["  ", ""]) {
      await assertRejects(() => span(db, s, taskId, s.F1, s.F2, reason), Error, "Нужна причина");
    }
  });
});

Deno.test("после срока с причиной — причина в последней добавленной строке", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 12) });
    await span(db, s, taskId, s.F1, s.F2, "  ждём подрядчика  ");
    const all = await rows(db, taskId);
    assertEquals(all.map((x) => x.plan_reason), [null, "ждём подрядчика"]);
    assertEquals(await dueOf(db, taskId), addDays(s.today, 12), "срок остался прежним");
  });
});

Deno.test("продление из идущего за её последний спринт — только с причиной", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 40) }); // срок далеко, после срока не выходим
    await place(db, s.A, taskId);
    await assertRejects(
      () => span(db, s, taskId, s.A, s.F1),
      Error,
      "Нужна причина: задача продлевается за последний спринт",
    );
    assertEquals((await rows(db, taskId)).length, 1);
    await span(db, s, taskId, s.A, s.F1, "не успеваем в один спринт");
    const all = await rows(db, taskId);
    assertEquals(all.map((x) => x.cycle_id), [s.A, s.F1]);
    assertEquals(all[1].plan_reason, "не успеваем в один спринт");
    assertEquals(all[0].plan_reason, null, "идущий не трогали");
  });
});

Deno.test("задача не из идущего, срок не нарушен — причина не нужна", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 40) });
    await place(db, s.F1, taskId);
    await span(db, s, taskId, s.F1, s.F2);
    assertEquals((await rows(db, taskId)).length, 2);
  });
});

Deno.test("снятая строка запланированного оживает, а не ломает уникальность", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 40) });
    await place(db, s.F1, taskId);
    await db.queryArray`update sprint_items set withdrawn_at = now() where task_id = ${taskId}`;
    await span(db, s, taskId, s.F1, s.F1);
    const all = await rows(db, taskId);
    assertEquals(all.length, 1);
    assertEquals(all[0].withdrawn_at, null);
  });
});

Deno.test("отказы: прошлый спринт, чужое пространство, обратный порядок, закрытая и приватная задача", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 40) });
    await assertRejects(() => span(db, s, taskId, s.P, s.F1), Error, "Прошлый спринт");
    await assertRejects(() => span(db, s, taskId, s.F1, s.otherTab), Error, "другого пространства");
    await assertRejects(() => span(db, s, taskId, s.F2, s.F1), Error, "раньше");
    const done = await addTask(db, s, { status: "done" });
    await assertRejects(() => span(db, s, done, s.F1, s.F1), Error, "Выполненной");
    const priv = await addTask(db, s, { isPrivate: true });
    await assertRejects(() => span(db, s, priv, s.F1, s.F1), Error, "Приватной");
    const arch = await addTask(db, s, { archived: true });
    await assertRejects(() => span(db, s, arch, s.F1, s.F1), Error, "архиве");
    assertEquals((await rows(db, taskId)).length, 0);
  });
});

Deno.test("функция доступна только service_role (урок GHSA-vxrp-599j-46hv)", async () => {
  const db = await connect();
  try {
    const sig = "public.sprint_set_task_span(uuid, uuid, text, uuid, uuid, text, text)";
    const q = async (role: string) =>
      (await db.queryObject<{ ok: boolean }>(
        `select has_function_privilege('${role}', '${sig}', 'execute') as ok`,
      )).rows[0].ok;
    assertEquals(await q("anon"), false, "anon не вызывает");
    assertEquals(await q("authenticated"), false, "authenticated не вызывает");
    assertEquals(await q("service_role"), true);
  } finally {
    await db.end();
  }
});
