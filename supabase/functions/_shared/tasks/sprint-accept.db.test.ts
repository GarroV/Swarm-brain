// Приёмка спринта на НАСТОЯЩЕЙ базе (локальный контур `supabase start`).
//
// Почему не мок: то, ради чего функция и написана, живёт в базе, а не в коде — атомарность
// транзакции, блокировка строки, уникальный индекс живого спринта, каскады и триггер удаления.
// Мок проверил бы мою же модель базы, а не базу.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять. Пропуск по
// причине «нет окружения» — это непроверенная проверка, которая выглядит зелёной.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";
import { type CarryInput, planCarry } from "./sprint-carry.ts";

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

const WS = "t_accept";

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
    insert into sprints (id, group_id, name, start_date, end_date, status)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active')
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
  isPrivate = false,
) {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, is_private, created_by)
    values (${title}, ${status}, ${WS}, ${projectId}, ${isPrivate}, 'test')
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

Deno.test("приёмка: что уехало, совпадает с planCarry", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);

    // Один и тот же состав описываем дважды: строками в базе и входом чистой функции. Если
    // SQL и planCarry когда-нибудь разойдутся, разойдутся и эти два ответа.
    const plan: (CarryInput & { title: string })[] = [
      {
        id: "",
        title: "сделана",
        status: "done",
        to_carry: false,
        removed_at: null,
      },
      {
        id: "",
        title: "отменена",
        status: "cancelled",
        to_carry: false,
        removed_at: null,
      },
      {
        id: "",
        title: "в работе",
        status: "in_progress",
        to_carry: false,
        removed_at: null,
      },
      {
        id: "",
        title: "помечена к переносу",
        status: "open",
        to_carry: true,
        removed_at: null,
      },
      {
        id: "",
        title: "в бэклоге",
        status: "backlog",
        to_carry: false,
        removed_at: null,
      },
    ];
    for (const row of plan) {
      const taskId = await addTask(db, projectId, row.status, row.title);
      row.id = taskId;
      await addItem(db, cycleId, taskId, row.to_carry);
    }

    const expected = planCarry(plan);
    const expectedCarried = new Set(
      expected.filter((d) => d.kind === "manual" || d.kind === "auto").map((
        d,
      ) => d.id),
    );

    const res = await accept(db, cycleId);
    const out = res.rows[0].result as Record<string, number | string>;
    const nextId = String(out.next_cycle_id);

    const moved = await db.queryObject<
      { task_id: string; carried_manual: boolean }
    >`
      select task_id, carried_manual from sprint_items where cycle_id = ${nextId}`;
    assertEquals(
      new Set(moved.rows.map((r) => r.task_id)),
      expectedCarried,
      "состав следующего спринта разошёлся с planCarry",
    );

    // Числа приходят внутри jsonb, то есть обычными числами JSON, а не bigint драйвера.
    assertEquals(
      out.carried_manual,
      expected.filter((d) => d.kind === "manual").length,
      "ручной перенос посчитан не так, как решает planCarry",
    );
    assertEquals(
      out.carried_auto,
      expected.filter((d) => d.kind === "auto").length,
      "автоматический перенос посчитан не так, как решает planCarry",
    );
  } finally {
    await db.end();
  }
});

Deno.test("приёмка: состав заморожен, а принятый спринт больше не живой", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "done", "сделана");
    await addItem(db, cycleId, taskId);

    await accept(db, cycleId);

    const frozen = await db.queryObject<
      { frozen_title: string; frozen_status: string; frozen_project: string }
    >`select frozen_title, frozen_status, frozen_project from sprint_items where cycle_id = ${cycleId}`;
    assertEquals(frozen.rows[0].frozen_title, "сделана");
    assertEquals(frozen.rows[0].frozen_status, "done");
    assertEquals(
      frozen.rows[0].frozen_project,
      "Инициатива",
      "имя инициативы в снимок не попало",
    );

    // Снимок обязан пережить дальнейшую жизнь задачи — иначе отчёт меняется задним числом.
    await db
      .queryArray`update tasks set title = 'переименована', status = 'open' where id = ${taskId}`;
    const after = await db.queryObject<{ frozen_title: string }>`
      select frozen_title from sprint_items where cycle_id = ${cycleId}`;
    assertEquals(after.rows[0].frozen_title, "сделана");

    const live = await db.queryObject<{ n: bigint }>`
      select count(*) as n from sprint_cycles
       where tab_id = ${tabId} and status in ('draft', 'active')`;
    assertEquals(
      live.rows[0].n,
      1n,
      "живой спринт в пространстве должен остаться ровно один",
    );
  } finally {
    await db.end();
  }
});

Deno.test("приёмка второй раз отбивается: спринт уже принят", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    await addItem(db, cycleId, await addTask(db, projectId, "open", "хвост"));

    await accept(db, cycleId);
    await assertRejects(
      () => accept(db, cycleId),
      Error,
      "идущий спринт",
      "повторная приёмка обязана отбиваться, иначе хвосты уедут дважды",
    );
  } finally {
    await db.end();
  }
});

Deno.test("два живых спринта в одном пространстве база не пускает", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    await startCycle(db, tabId);
    const err = await assertRejects(() =>
      startCycle(db, tabId, "Спринт 1-бис")
    );
    assert(
      String((err as { fields?: { code?: string } }).fields?.code ?? err) ===
        "23505",
      `ожидался отказ уникального индекса 23505, пришло: ${err}`,
    );
  } finally {
    await db.end();
  }
});

Deno.test("приватная задача в следующий спринт не переезжает", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const openId = await addTask(db, projectId, "open", "общая");
    const privateId = await addTask(db, projectId, "open", "личная", true);
    await addItem(db, cycleId, openId);
    await addItem(db, cycleId, privateId);

    const res = await accept(db, cycleId);
    const nextId = String(
      (res.rows[0].result as Record<string, unknown>).next_cycle_id,
    );
    const moved = await db.queryObject<{ task_id: string }>`
      select task_id from sprint_items where cycle_id = ${nextId}`;
    assertEquals(
      moved.rows.map((r) => r.task_id),
      [openId],
      "приватная задача уехала бы в спринт, где её состав видит вся команда",
    );
  } finally {
    await db.end();
  }
});

Deno.test("удаление задачи оставляет упоминание в непринятом спринте", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "open", "будет удалена");
    await addItem(db, cycleId, taskId);

    // Удаляем напрямую, как это делает бот при работе со встречей: код приложения такой путь
    // не видит, поэтому упоминание и держит триггер.
    await db.queryArray`delete from tasks where id = ${taskId}`;

    const row = await db.queryObject<
      {
        removed_title: string;
        removed_at: Date;
        removed_project_id: string;
        task_id: string | null;
      }
    >`select removed_title, removed_at, removed_project_id, task_id from sprint_items where cycle_id = ${cycleId}`;
    assertEquals(row.rows.length, 1, "строка состава пропала вместе с задачей");
    assertEquals(row.rows[0].removed_title, "будет удалена");
    assertEquals(row.rows[0].removed_project_id, projectId);
    assert(
      row.rows[0].removed_at instanceof Date,
      "время удаления не записано",
    );
    assertEquals(
      row.rows[0].task_id,
      null,
      "связь должна обнулиться внешним ключом",
    );
  } finally {
    await db.end();
  }
});

Deno.test("упоминание удалённой задачи никуда не переносится", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "open", "удалена по ходу");
    await addItem(db, cycleId, taskId, true);
    await db.queryArray`delete from tasks where id = ${taskId}`;

    const res = await accept(db, cycleId);
    const out = res.rows[0].result as Record<string, unknown>;
    const nextId = String(out.next_cycle_id);
    const moved = await db.queryObject<{ n: bigint }>`
      select count(*) as n from sprint_items where cycle_id = ${nextId}`;
    assertEquals(
      moved.rows[0].n,
      0n,
      "упоминание уехало в следующий спринт призраком",
    );
    assertEquals(out.frozen, 0, "у упоминания нечего замораживать");
  } finally {
    await db.end();
  }
});

Deno.test("принятый спринт удаление задачи не переписывает", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const cycleId = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "done", "сделана и удалена");
    await addItem(db, cycleId, taskId);
    await accept(db, cycleId);

    await db.queryArray`delete from tasks where id = ${taskId}`;

    const row = await db.queryObject<
      { frozen_title: string; removed_at: Date | null }
    >`
      select frozen_title, removed_at from sprint_items where cycle_id = ${cycleId}`;
    assertEquals(row.rows[0].frozen_title, "сделана и удалена");
    assertEquals(
      row.rows[0].removed_at,
      null,
      "архив принятого спринта не должен меняться",
    );
  } finally {
    await db.end();
  }
});

Deno.test("количество переносов растёт, а не пересчитывается обходом", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const first = await startCycle(db, tabId);
    const taskId = await addTask(db, projectId, "open", "долгожитель");
    await addItem(db, first, taskId);

    const r1 = await accept(db, first);
    const second = String(
      (r1.rows[0].result as Record<string, unknown>).next_cycle_id,
    );
    await db
      .queryArray`update sprint_cycles set status = 'active' where id = ${second}`;
    const r2 = await accept(db, second);
    const third = String(
      (r2.rows[0].result as Record<string, unknown>).next_cycle_id,
    );

    const counts = await db.queryObject<
      { carry_count: number; cycle_id: string }
    >`
      select carry_count, cycle_id from sprint_items where task_id = ${taskId} order by carry_count`;
    assertEquals(counts.rows.map((r) => r.carry_count), [0, 1, 2]);
    assertEquals(counts.rows[2].cycle_id, third);
  } finally {
    await db.end();
  }
});
