// Журнал пространства: лента и её гвард — на настоящем обработчике и настоящей базе.
//
// Главный риск здесь не «лента пустая», а «лента показала лишнее»: она собирается из чужих
// таблиц (история, комментарии, состав спринтов), и каждая из них про задачу, к которой у
// человека может не быть доступа. Мок такую ошибку не ловит — он согласится с моей моделью.
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

const { handleSpaceJournalRoutes } = await import("./space-journal.ts");

const WS = "t_journal";
const OTHER_WS = "t_journal_other";
const ME = 333;
const SOMEONE_ELSE = 444;

interface Event {
  kind: string;
  task_title: string | null;
  text: string;
}

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
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db
      .queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${ws})`;
    await db
      .queryArray`delete from task_comments where task_id in (select id from tasks where group_id = ${ws})`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
  }
  await db
    .queryArray`delete from allowed_users where telegram_id in (${ME}, ${SOMEONE_ELSE})`;
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db
      .queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
  }
  for (const person of [ME, SOMEONE_ELSE]) {
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${person}, ${"u" + person}, 0, ${WS})`;
  }

  const tab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active')
    returning id`;
  const foreignTab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status)
    values (gen_random_uuid(), ${OTHER_WS}, 'Чужое', current_date, current_date + 30, 'active')
    returning id`;
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name, sprint_id) values (${WS}, 'Инициатива', ${
    tab.rows[0].id
  }) returning id`;
  return {
    tabId: tab.rows[0].id,
    foreignTabId: foreignTab.rows[0].id,
    projectId: project.rows[0].id,
  };
}

async function journal(tabId: string, days = "7", as = ME) {
  const req = new Request(
    `https://api.test/spaces/${tabId}/journal?days=${days}`,
  );
  const res = await handleSpaceJournalRoutes(
    req,
    `/spaces/${tabId}/journal`,
    as,
    WS,
    "https://web.test",
    () => Promise.resolve(new Map()),
  );
  return res!;
}

Deno.test("чужая приватная задача не попадает в ленту ни одним событием", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const mine = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by)
      values ('Общая задача', 'open', ${WS}, ${projectId}, 'test') returning id`;
    const theirs = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, is_private, owner_id, created_by)
      values ('Личное дело', 'open', ${WS}, ${projectId}, true, ${SOMEONE_ELSE}, 'test')
      returning id`;

    for (const id of [mine.rows[0].id, theirs.rows[0].id]) {
      await db.queryArray`
        insert into task_history (task_id, field, old_value, new_value, changed_by, group_id)
        values (${id}, 'status', 'open', 'in_progress', 'tester', ${WS})`;
      await db.queryArray`
        insert into task_comments (task_id, content, added_by)
        values (${id}, 'комментарий', 'tester')`;
    }

    const { events } = await (await journal(tabId)).json() as {
      events: Event[];
    };
    const titles = events.map((e) => e.task_title);
    assertEquals(
      titles.includes("Общая задача"),
      true,
      "своё событие должно быть в ленте",
    );
    assertEquals(
      titles.includes("Личное дело"),
      false,
      "журнал не должен становиться обходным путём к чужой приватной задаче",
    );
    assertEquals(
      events.some((e) =>
        e.text.includes("комментарий") && e.task_title === "Личное дело"
      ),
      false,
      "комментарий к чужой приватной задаче тоже не показывается",
    );

    const owner = await (await journal(tabId, "7", SOMEONE_ELSE)).json() as {
      events: Event[];
    };
    assertEquals(
      owner.events.some((e) => e.task_title === "Личное дело"),
      true,
      "владелец свою приватную задачу в ленте видит",
    );
  } finally {
    await db.end();
  }
});

Deno.test("вкладка чужого воркспейса — 404, а не пустая лента", async () => {
  const db = await connect();
  try {
    const { foreignTabId } = await seed(db);
    // Пустая лента выглядит как «событий нет» и не даёт понять, что человек смотрит не туда.
    assertEquals((await journal(foreignTabId)).status, 404);
  } finally {
    await db.end();
  }
});

Deno.test("период фильтрует: старое событие в «за сутки» не попадает", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by)
      values ('Задача', 'open', ${WS}, ${projectId}, 'test') returning id`;
    await db.queryArray`
      insert into task_history (task_id, field, old_value, new_value, changed_by, group_id, created_at)
      values (${
      task.rows[0].id
    }, 'status', 'open', 'done', 'tester', ${WS}, now() - interval '5 days')`;

    const week = await (await journal(tabId, "7")).json() as {
      events: Event[];
    };
    assertEquals(week.events.some((e) => e.kind === "task_change"), true);

    const day = await (await journal(tabId, "1")).json() as { events: Event[] };
    assertEquals(day.events.some((e) => e.kind === "task_change"), false);

    const all = await (await journal(tabId, "all")).json() as {
      events: Event[];
    };
    assertEquals(all.events.some((e) => e.kind === "task_change"), true);
  } finally {
    await db.end();
  }
});

Deno.test("негодный период — отказ, а не тихо «за неделю»", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    assertEquals((await journal(tabId, "30")).status, 400);
  } finally {
    await db.end();
  }
});

Deno.test("события спринта и его состава попадают в ленту", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by)
      values ('Задача спринта', 'open', ${WS}, ${projectId}, 'test') returning id`;
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status, started_at)
      values (${WS}, ${tabId}, 'Спринт 1', current_date - 7, current_date + 6, 'active', now())
      returning id`;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan, check_status, check_at, check_by, to_carry, carry_reason, carry_at, carry_by)
      values (${cycle.rows[0].id}, ${
      task.rows[0].id
    }, true, 'risk', now(), 'tester', true, 'ждём смежников', now(), 'tester')`;

    const { events } = await (await journal(tabId)).json() as {
      events: Event[];
    };
    const kinds = events.map((e) => e.kind);
    assertEquals(kinds.includes("cycle_started"), true);
    assertEquals(kinds.includes("item_added"), true);
    assertEquals(kinds.includes("check"), true);
    assertEquals(
      events.find((e) => e.kind === "carry")?.text,
      "К переносу: ждём смежников",
      "причина переноса — самое ценное в ленте: по ней потом объясняют, почему не успели",
    );
  } finally {
    await db.end();
  }
});

Deno.test("удалённая задача объясняется в ленте, а не исчезает молча", async () => {
  const db = await connect();
  try {
    const { tabId, projectId } = await seed(db);
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by)
      values ('Исчезнувшая', 'open', ${WS}, ${projectId}, 'test') returning id`;
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date - 7, current_date + 6, 'active')
      returning id`;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan)
      values (${cycle.rows[0].id}, ${task.rows[0].id}, true)`;
    await db.queryArray`delete from tasks where id = ${task.rows[0].id}`;

    const { events } = await (await journal(tabId)).json() as {
      events: Event[];
    };
    const removed = events.find((e) => e.kind === "removed");
    assertEquals(removed?.task_title, "Исчезнувшая");
    assertEquals(removed?.text.includes("упоминанием"), true);
  } finally {
    await db.end();
  }
});
