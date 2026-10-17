// Задачи закрытого проекта видит только тот, кто видит проект, — на путях МИМО listTasks: состав
// спринта, журнал пространства, итоги принятого спринта, контекст встречи, бот, массовые записи
// по присланным id (решение владельца 16.10.2026, docs/decisions/2026-10-16-security-fixes.md).
//
// Почему на базе: каждый из этих путей ходит SERVICE_ROLE_KEY своей выборкой. Пропущенный фильтр
// не падает — задача просто показывается или правится чужой рукой.
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

const { addItems, listComposition, removeItem, updateItem } = await import("./sprint-items.ts");
const { setTasksSprint } = await import("./sprints.ts");
const { getVisibleTaskInWorkspace } = await import("./db.ts");
const { loadCountryTasks } = await import("./country-tasks.ts");
const { redactCycleStats } = await import("./sprint-cycles.ts");
const { loadSpaceJournal } = await import("../space-journal.ts");
const bot = await import("../../swarm-bot/tasks/db.ts");

const WS = "t_ppaths";
const OTHER_WS = "t_ppaths_other";
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

type Seeded = {
  open: string;
  closed: string;
  tabId: string;
  cycleId: string;
  acceptedId: string;
  tOpen: string;
  tClosed: string;
  tSub: string;
  tNone: string;
  tForeign: string;
};

async function seed(db: Client): Promise<Seeded> {
  for (const ws of [WS, OTHER_WS]) {
    await db
      .queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${ws})`;
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db
      .queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${ws})`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`update projects set parent_id = null where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
  }

  const project = async (name: string, priv: boolean, parent: string | null = null) =>
    (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private, parent_id)
      values (${WS}, ${name}, ${AUTHOR}, ${priv}, ${parent}) returning id`).rows[0].id;
  const task = async (title: string, projectId: string | null, ws = WS) =>
    (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by, confirmed, country, meeting_id)
      values (${title}, 'open', ${ws}, ${projectId}, 'test', true, 'RS', null) returning id`).rows[0].id;

  const open = await project("Открытый", false);
  const closed = await project("Закрытый", true);
  const sub = await project("Подпроект закрытого", false, closed);
  const tOpen = await task("в открытом", open);
  const tClosed = await task("в закрытом", closed);
  const tSub = await task("в подпроекте закрытого", sub);
  const tNone = await task("без проекта", null);
  const tForeign = await task("чужой воркспейс", null, OTHER_WS);

  const tabId = (await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active', 'space')
    returning id`).rows[0].id;
  const cycleId = (await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status, started_at)
    values (${WS}, ${tabId}, 'Идёт', current_date - 3, current_date + 10, 'active', now())
    returning id`).rows[0].id;
  for (const t of [tOpen, tClosed, tSub, tNone]) {
    await db.queryArray`insert into sprint_items (cycle_id, task_id, in_plan) values (${cycleId}, ${t}, true)`;
  }
  // Упоминание удалённой задачи закрытого проекта: имя осталось строкой, проект — id.
  await db.queryArray`
    insert into sprint_items (cycle_id, task_id, in_plan, removed_title, removed_project_id, removed_at)
    values (${cycleId}, null, true, 'удалённая из закрытого', ${closed}, now())`;

  // Принятый спринт: строка заморожена, проект записан ИМЕНЕМ, итоги лежат в stats.
  const stats = {
    planPercent: 50,
    byProject: [
      { name: "Закрытый", total: 1, done: 0 },
      { name: "Открытый", total: 1, done: 1 },
    ],
  };
  const acceptedId = (await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status, accepted_at, stats)
    values (${WS}, ${tabId}, 'Принят', current_date - 30, current_date - 16, 'accepted', now() - interval '16 days', ${
    JSON.stringify(stats)
  }::jsonb)
    returning id`).rows[0].id;
  await db.queryArray`
    insert into sprint_items (cycle_id, task_id, in_plan, frozen_at, frozen_title, frozen_status, frozen_project)
    values (${acceptedId}, ${tClosed}, true, now(), 'заморожена в закрытом', 'open', 'Закрытый')`;
  await db.queryArray`
    insert into sprint_items (cycle_id, task_id, in_plan, frozen_at, frozen_title, frozen_status, frozen_project)
    values (${acceptedId}, ${tOpen}, true, now(), 'заморожена в открытом', 'done', 'Открытый')`;

  return { open, closed, tabId, cycleId, acceptedId, tOpen, tClosed, tSub, tNone, tForeign };
}

const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title).sort();

Deno.test("состав спринта: задачи и имена невидимого проекта не показываются, автору — всё", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    const member = await listComposition(s.cycleId, WS, { viewerId: MEMBER });
    assertEquals(titles(member.items), ["без проекта", "в открытом"]);
    assert(member.items.every((i) => i.project !== "Закрытый" && i.project !== "Подпроект закрытого"));

    const author = await listComposition(s.cycleId, WS, { viewerId: AUTHOR });
    assertEquals(titles(author.items), [
      "без проекта",
      "в закрытом",
      "в открытом",
      "в подпроекте закрытого",
      "удалённая из закрытого",
    ]);

    // Принятый спринт: замороженная строка тоже прячется — проект берётся у самой задачи.
    const frozen = await listComposition(s.acceptedId, WS, { viewerId: MEMBER });
    assertEquals(titles(frozen.items), ["заморожена в открытом"]);

    // Приёмка считает итоги по полному составу — для неё отдельный, явный режим.
    const all = await listComposition(s.cycleId, WS, "everyone");
    assertEquals(all.items.length, 5);
  } finally {
    await db.end();
  }
});

Deno.test("итоги принятого спринта: ни имён, ни счёта задач невидимого проекта", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    const row = await db.queryObject<{ id: string; status: string; stats: Record<string, unknown> }>`
      select id, status, stats from sprint_cycles where id = ${s.acceptedId}`;
    const cycle = row.rows[0];
    type Stats = {
      plan: number;
      planDone: number;
      planPercent: number;
      byProject: Array<{ name: string }>;
      byPerson: unknown[];
    };
    const [forMember] = await redactCycleStats([cycle], WS, MEMBER);
    const st = forMember.stats as Stats;
    // Участник видит одну плановую задачу (выполненную) — итог считается по ней, а не по всему
    // плану: иначе процент и счётчики выдавали бы, сколько в спринте скрытых задач.
    assertEquals(st.byProject.map((p) => p.name), ["Открытый"]);
    assertEquals([st.plan, st.planDone, st.planPercent], [1, 1, 100]);
    // Кто видит всё — получает итоги как записаны при приёмке, без пересчёта.
    const [forAuthor] = await redactCycleStats([cycle], WS, AUTHOR);
    assertEquals(forAuthor.stats, cycle.stats);
    // Спринт без скрытых строк не пересчитывается и у участника.
    await db.queryArray`delete from sprint_items where cycle_id = ${s.acceptedId} and task_id = ${s.tClosed}`;
    const [plain] = await redactCycleStats([cycle], WS, MEMBER);
    assertEquals(plain.stats, cycle.stats);
  } finally {
    await db.end();
  }
});

Deno.test("состав спринта: невидимую задачу нельзя ни добавить, ни отметить, ни снять", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    await db.queryArray`delete from sprint_items where cycle_id = ${s.cycleId}`;
    const added = await addItems(s.cycleId, [s.tClosed, s.tSub, s.tOpen], WS, String(MEMBER), MEMBER);
    assertEquals(added, 1);
    const rows = await db.queryObject<{ task_id: string }>`
      select task_id from sprint_items where cycle_id = ${s.cycleId}`;
    assertEquals(rows.rows.map((r) => r.task_id), [s.tOpen]);

    // Автор добавляет свою задачу закрытого проекта — участник её не отметит и не снимет.
    assertEquals(await addItems(s.cycleId, [s.tClosed], WS, String(AUTHOR), AUTHOR), 1);
    assertEquals(
      await updateItem(s.cycleId, s.tClosed, WS, { check_status: "risk" }, String(MEMBER), MEMBER),
      null,
    );
    assertEquals(await removeItem(s.cycleId, s.tClosed, WS, String(MEMBER), MEMBER), false);
    const item = await db.queryObject<{ check_status: string | null; withdrawn_at: string | null }>`
      select check_status, withdrawn_at from sprint_items where cycle_id = ${s.cycleId} and task_id = ${s.tClosed}`;
    assertEquals(item.rows[0], { check_status: null, withdrawn_at: null });

    // Своя видимая задача отмечается как раньше.
    const marked = await updateItem(s.cycleId, s.tOpen, WS, { check_status: "ok" }, String(MEMBER), MEMBER);
    assertEquals(marked?.check_status, "ok");
    assert(await removeItem(s.cycleId, s.tOpen, WS, String(MEMBER), MEMBER));
  } finally {
    await db.end();
  }
});

Deno.test("журнал пространства: события задач невидимого проекта не попадают в ленту", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    const noNames = () => Promise.resolve(new Map<number, string>());
    const member = await loadSpaceJournal(s.tabId, WS, MEMBER, "all", noNames);
    assert(member.ok);
    const seen = new Set(member.events.map((e) => e.task_title));
    assert(seen.has("в открытом"));
    assert(seen.has("без проекта"));
    for (const hidden of ["в закрытом", "в подпроекте закрытого", "удалённая из закрытого"]) {
      assert(!seen.has(hidden), `участник видит «${hidden}» в журнале`);
    }

    // Процент приёмки в ленте — из итогов, пересчитанных по видимому составу (redactCycleStats):
    // записанный процент считал и скрытые задачи.
    const acceptedPercent = (r: typeof member) =>
      r.ok ? r.events.find((e) => e.kind === "cycle_accepted")?.params?.percent : undefined;
    assertEquals(acceptedPercent(member), 100);

    const author = await loadSpaceJournal(s.tabId, WS, AUTHOR, "all", noNames);
    assert(author.ok);
    assertEquals(acceptedPercent(author), 50);
    const authorSeen = new Set(author.events.map((e) => e.task_title));
    assert(authorSeen.has("в закрытом"));
    assert(authorSeen.has("удалённая из закрытого"));
  } finally {
    await db.end();
  }
});

Deno.test("контекст встречи: задачи страны из невидимого проекта не показываются", async () => {
  const db = await connect();
  try {
    await seed(db);
    const opts = { groupId: WS, country: "RS", hiddenStatuses: ["done"], limit: 10 };
    assertEquals(titles(await loadCountryTasks({ ...opts, viewerId: MEMBER })), ["без проекта", "в открытом"]);
    assertEquals((await loadCountryTasks({ ...opts, viewerId: AUTHOR })).length, 4);
  } finally {
    await db.end();
  }
});

Deno.test("привязка к вкладке доски по id: невидимые задачи не трогаются", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    const tab = (await db.queryObject<{ id: string }>`
      insert into sprints (id, group_id, name, start_date, end_date, status)
      values (gen_random_uuid(), ${WS}, 'Вкладка', current_date, current_date + 30, 'active') returning id`).rows[0].id;
    const n = await setTasksSprint([s.tClosed, s.tSub, s.tOpen, s.tForeign], tab, WS, MEMBER);
    assertEquals(n, 1);
    const rows = await db.queryObject<{ id: string }>`select id from tasks where sprint_id = ${tab}`;
    assertEquals(rows.rows.map((r) => r.id), [s.tOpen]);

    // Автор отвязывает свою задачу закрытого проекта — может.
    await db.queryArray`update tasks set sprint_id = ${tab} where id = ${s.tClosed}`;
    assertEquals(await setTasksSprint([s.tClosed], null, WS, MEMBER), 0);
    assertEquals(await setTasksSprint([s.tClosed], null, WS, AUTHOR), 1);
  } finally {
    await db.end();
  }
});

Deno.test("родитель подзадачи: невидимая и чужая задача — как несуществующая", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    assertEquals(await getVisibleTaskInWorkspace(s.tClosed, WS, MEMBER), null);
    assertEquals(await getVisibleTaskInWorkspace(s.tSub, WS, MEMBER), null);
    assertEquals(await getVisibleTaskInWorkspace(s.tForeign, WS, MEMBER), null);
    assert(await getVisibleTaskInWorkspace(s.tOpen, WS, MEMBER));
    assert(await getVisibleTaskInWorkspace(s.tNone, WS, MEMBER));
    assert(await getVisibleTaskInWorkspace(s.tClosed, WS, AUTHOR));
  } finally {
    await db.end();
  }
});

Deno.test("бот: карточка, смена статуса и удаление по id — только своей видимой задачи", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    const member = { groupId: WS, viewerId: MEMBER };
    assertEquals(await bot.dbGetTask(s.tClosed, member), null);
    assertEquals(await bot.dbGetTask(s.tForeign, member), null);
    assert(await bot.dbGetTask(s.tOpen, member));
    assert(await bot.dbGetTask(s.tClosed, { groupId: WS, viewerId: AUTHOR }));

    await bot.dbUpdateTask(s.tClosed, { status: "done" }, { actorTelegramId: MEMBER }, member);
    await bot.dbUpdateTask(s.tForeign, { status: "done" }, { actorTelegramId: MEMBER }, member);
    assertEquals(await bot.dbDeleteTask(s.tSub, member), false);
    const rows = await db.queryObject<{ id: string; status: string; archived_at: string | null }>`
      select id, status, archived_at from tasks where id in (${s.tClosed}, ${s.tForeign}, ${s.tSub})`;
    assert(rows.rows.every((r) => r.status === "open" && r.archived_at === null));

    // Видимая задача правится как раньше.
    await bot.dbUpdateTask(s.tOpen, { status: "in_progress" }, { actorTelegramId: MEMBER }, member);
    assertEquals((await bot.dbGetTask(s.tOpen, member))?.status, "in_progress");
  } finally {
    await db.end();
  }
});

Deno.test("бот: «Выполненные» и экспорт не отдают задачи невидимого проекта", async () => {
  const db = await connect();
  try {
    const s = await seed(db);
    await db.queryArray`update tasks set status = 'done' where id in (${s.tOpen}, ${s.tClosed})`;
    assertEquals(titles(await bot.dbListDone(WS, MEMBER)), ["в открытом"]);
    assertEquals(titles(await bot.dbListDone(WS, AUTHOR)), ["в закрытом", "в открытом"]);
    assertEquals(titles(await bot.dbListForExport(WS, MEMBER)), ["без проекта", "в открытом"]);
    assertEquals((await bot.dbListForExport(WS, AUTHOR)).length, 4);
  } finally {
    await db.end();
  }
});
