// Архив задач (#489) — на настоящем обработчике и настоящей базе: здесь проверяется РЕШЕНИЕ О
// ДОСТУПЕ, а ошибка в нём выглядит как работающий продукт и вылезает утечкой чужого воркспейса.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
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

// Импорт динамический: клиент базы создаётся на уровне модуля, переменные обязаны стоять раньше.
const { handleTaskArchiveRoutes } = await import("./task-archive.ts");

const WS = "t_task_archive";
const OTHER_WS = "t_task_archive_other";
const ME = 900489;
const SOMEONE_ELSE = 900490;

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  await db.connect();
  return db;
}

async function seed(db: Client) {
  for (const ws of [WS, OTHER_WS]) await db.queryArray`delete from tasks where group_id = ${ws}`;
  await db.queryArray`delete from allowed_users where telegram_id in (${ME}, ${SOMEONE_ELSE})`;
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
  }
  for (const person of [ME, SOMEONE_ELSE]) {
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${person}, ${"u" + person}, 0, ${WS})`;
  }
  const add = async (title: string, ws: string, createdBy: number) =>
    (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by, created_by_telegram_id, archived_at)
      values (${title}, 'open', ${ws}, 'test', ${createdBy}, now())
      returning id`).rows[0].id;
  return {
    mine: await add("Моя в архиве", WS, ME),
    colleague: await add("Задача коллеги в архиве", WS, SOMEONE_ELSE),
    foreign: await add("Чужой воркспейс", OTHER_WS, SOMEONE_ELSE),
  };
}

function call(method: string, path: string) {
  return handleTaskArchiveRoutes(
    new Request(`https://api.test${path}`, { method }),
    path,
    WS,
    "https://web.test",
  );
}

// «Личных» задач нет (решение 2026-10-09): архив воркспейса виден любому его участнику целиком,
// а граница одна — воркспейс.
Deno.test("архив: видны задачи воркспейса (свои и коллег), чужой воркспейс — нет", async () => {
  const db = await connect();
  try {
    const ids = await seed(db);
    const res = await call("GET", "/tasks/archived");
    assertEquals(res?.status, 200);
    const got = new Set(((await res!.json()) as { id: string }[]).map((t) => t.id));
    assert(got.has(ids.mine) && got.has(ids.colleague), "задачи своего воркспейса должны быть видны");
    assert(!got.has(ids.foreign), "архив чужого воркспейса — утечка");
  } finally {
    await db.end();
  }
});

Deno.test("возврат: задача коллеги возвращается, чужой воркспейс — 404", async () => {
  const db = await connect();
  try {
    const ids = await seed(db);
    assertEquals((await call("POST", `/tasks/${ids.foreign}/restore`))?.status, 404);
    assertEquals((await call("POST", `/tasks/${ids.colleague}/restore`))?.status, 204);
    const back = await db.queryObject<{ archived_at: string | null }>`
      select archived_at from tasks where id = ${ids.colleague}`;
    assertEquals(back.rows[0].archived_at, null);
    assertEquals(
      (await call("POST", `/tasks/${ids.colleague}/restore`))?.status,
      404,
      "живую задачу возвращать неоткуда",
    );
  } finally {
    await db.end();
  }
});
