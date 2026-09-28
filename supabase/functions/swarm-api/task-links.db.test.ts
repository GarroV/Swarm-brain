// Ссылки у задачи и поля инициативы — на настоящей базе, через тот же путь записи, что в проде.
//
// Юнит-тесты `parseLinks` уже проверяют схему; здесь проверяется другое: что разобранное
// действительно ДОЕЗЖАЕТ до колонки и возвращается обратно. Ровно это и ломается молча —
// поле разобрано, а в insert не попало, и продукт выглядит работающим.
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

const { createTask, updateTask } = await import("../_shared/tasks/db.ts");
const { createProject, getProject, updateProject } = await import(
  "../_shared/tasks/projects.ts"
);

const WS = "t_links";

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
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db
    .queryArray`insert into workspaces (id, name) values (${WS}, 'Ссылки')`;
}

Deno.test("ссылки доезжают до колонки и возвращаются обратно", async () => {
  const db = await connect();
  try {
    await seed(db);
    const task = await createTask({
      title: "Задача со ссылками",
      links: [
        { title: "Материалы", url: "https://example.com/doc" },
        { title: null, url: "https://example.com/second" },
      ],
    }, WS);

    const row = await db.queryObject<{ links: unknown }>`
      select links from tasks where id = ${task.id}`;
    assertEquals(row.rows[0].links, [
      { title: "Материалы", url: "https://example.com/doc" },
      { title: null, url: "https://example.com/second" },
    ]);
  } finally {
    await db.end();
  }
});

Deno.test("задача без ссылок получает пустой список, а не null", async () => {
  const db = await connect();
  try {
    await seed(db);
    const task = await createTask({ title: "Без ссылок" }, WS);
    const row = await db.queryObject<{ links: unknown }>`
      select links from tasks where id = ${task.id}`;
    // Колонка not null: фронт рисует поле сразу, не проверяя на null.
    assertEquals(row.rows[0].links, []);
  } finally {
    await db.end();
  }
});

Deno.test("правка ссылок заменяет список целиком и пишется в журнал адресами", async () => {
  const db = await connect();
  try {
    await seed(db);
    const task = await createTask({
      title: "Задача",
      links: [{ title: null, url: "https://example.com/one" }],
    }, WS);

    await updateTask(
      task.id,
      { links: [{ title: "Второй", url: "https://example.com/two" }] },
      { actor: "tester" },
    );

    const row = await db.queryObject<{ links: { url: string }[] }>`
      select links from tasks where id = ${task.id}`;
    assertEquals(row.rows[0].links.map((l: { url: string }) => l.url), [
      "https://example.com/two",
    ]);

    const hist = await db.queryObject<{ old_value: string; new_value: string }>`
      select old_value, new_value from task_history
       where task_id = ${task.id} and field = 'links'`;
    assertEquals(
      hist.rows.length,
      1,
      "смена ссылок обязана попасть в журнал задачи",
    );
    // «[object Object]» в истории не говорит ничего — нужен адрес.
    assertEquals(hist.rows[0].old_value, "https://example.com/one");
    assertEquals(hist.rows[0].new_value, "https://example.com/two");
  } finally {
    await db.end();
  }
});

Deno.test("в колонку links нельзя положить не список", async () => {
  const db = await connect();
  try {
    await seed(db);
    const task = await createTask({ title: "Задача" }, WS);
    let failed = false;
    try {
      await db
        .queryArray`update tasks set links = '{"url": "x"}'::jsonb where id = ${task.id}`;
    } catch {
      // Ограничение базы — последний рубеж: код уже проверяет, но писать в tasks умеет не
      // только он (бот, MCP, ручные правки), и объект вместо списка сломал бы отрисовку.
      failed = true;
    }
    assertEquals(failed, true, "база обязана отбить объект вместо списка");
  } finally {
    await db.end();
  }
});

Deno.test("ответственный и сроки инициативы записываются и правятся", async () => {
  const db = await connect();
  try {
    await seed(db);
    const project = await createProject(
      {
        name: "Инициатива",
        owner_telegram_id: 744230399,
        start_date: "2026-09-01",
        end_date: "2026-09-30",
      },
      WS,
      744230399,
    );

    const saved = await getProject(project.id, WS);
    assertEquals(saved?.owner_telegram_id, 744230399);
    assertEquals(saved?.start_date, "2026-09-01");
    assertEquals(saved?.end_date, "2026-09-30");

    await updateProject(project.id, { end_date: "2026-10-15" }, WS, {
      viewerId: 744230399,
    });
    assertEquals((await getProject(project.id, WS))?.end_date, "2026-10-15");
  } finally {
    await db.end();
  }
});
