// Задачи из профиля в боте — на настоящей базе: только текущее пространство, и цель обязана
// в нём состоять. Ошибка здесь не падает — она показывает задачи чужого пространства.
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

const { loadProfileTasks } = await import("./profile-tasks.ts");

const WS = "t_ptasks";
const OTHER_WS = "t_ptasks_other";
const TARGET = 880000301;
const OUTSIDER = 880000302;

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
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from allowed_users where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, 'Профиль')`;
  }
  await db.queryArray`delete from user_profiles where telegram_id in (${TARGET}, ${OUTSIDER})`;
  await db.queryArray`
    insert into allowed_users (telegram_id, group_id, username, added_by)
    values (${TARGET}, ${WS}, 'target', ${TARGET}), (${OUTSIDER}, ${OTHER_WS}, 'outsider', ${OUTSIDER})`;
  await db.queryArray`
    insert into user_profiles (telegram_id, first_name, last_name)
    values (${TARGET}, 'Тестовый', 'Исполнитель'), (${OUTSIDER}, 'Чужой', 'Человек')`;
  await db.queryArray`
    insert into tasks (title, status, group_id, created_by, confirmed, assignees) values
      ('своя задача', 'open', ${WS}, 'test', true, array['Тестовый Исполнитель']),
      ('задача другого пространства', 'open', ${OTHER_WS}, 'test', true, array['Тестовый Исполнитель'])`;
}

Deno.test("задачи профиля — только текущего пространства", async () => {
  const db = await connect();
  try {
    await seed(db);
    const loaded = await loadProfileTasks(TARGET, WS);
    assertEquals(loaded?.name, "Тестовый Исполнитель");
    assertEquals(loaded?.tasks.map((t) => t.title), ["своя задача"]);
  } finally {
    await db.end();
  }
});

Deno.test("человек другого пространства — отказ, а не его задачи", async () => {
  const db = await connect();
  try {
    await seed(db);
    assertEquals(await loadProfileTasks(OUTSIDER, WS), null);
  } finally {
    await db.end();
  }
});
