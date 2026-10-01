// Целостность обновления задачи — на НАСТОЯЩЕЙ базе (issue #577).
//
// Три дефекта, и все три живут на стыке кода и базы, поэтому мок их не поймает:
//   F-019 — запись в tasks упала, а веб/бот/MCP сказали «обновлено» и журнал записал изменение,
//           которого в базе нет;
//   F-027 — журнал писался отдельным вызовом: сбой журнала не откатывал изменение;
//   F-018 — повторное «готово» по регулярной задаче (двойной клик, ретрай MCP) перекатывало
//           срок ещё на период, и вхождение графика пропадало.
//
// Базы нет — тест падает с причиной, а не пропускается (пропуск выглядел бы проверенным).
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

Deno.env.set(
  "SUPABASE_URL",
  Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321",
);
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

const { updateTask } = await import("./db.ts");
const { todayInTz, nextOccurrence } = await import("./recurrence.ts");

const WS = "t_task_update";
const ACTOR = 515151;

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

async function seed(db: Client) {
  await db
    .queryArray`delete from task_history where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db
    .queryArray`insert into workspaces (id, name) values (${WS}, 'Тест обновления')`;
}

async function addTask(
  db: Client,
  opts: { due?: string; freq?: string } = {},
): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, created_by, due_date, recur_freq)
    values ('Задача', 'open', ${WS}, 'test', ${opts.due ?? null}, ${opts.freq ?? null})
    returning id`;
  return r.rows[0].id;
}

async function row(db: Client, id: string) {
  const r = await db.queryObject<
    { status: string; due: string | null; title: string }
  >`select status, due_date::text as due, title from tasks where id = ${id}`;
  return r.rows[0];
}

async function historyCount(db: Client, id: string): Promise<number> {
  const r = await db.queryObject<{ n: number }>`
    select count(*)::int as n from task_history where task_id = ${id}`;
  return r.rows[0].n;
}

Deno.test("F-019: сбой записи задачи — ошибка наружу, журнал пуст", async () => {
  const db = await connect();
  try {
    await seed(db);
    const id = await addTask(db, { due: "2026-10-05" });

    // Невалидная дата: Postgres отбивает UPDATE. Раньше updateTask молча возвращал успех,
    // а журнал записывал «срок: 2026-10-05 → не дата».
    await assertRejects(() => updateTask(id, { due_date: "не дата" }, { actorTelegramId: ACTOR }));

    assertEquals((await row(db, id)).due, "2026-10-05");
    assertEquals(
      await historyCount(db, id),
      0,
      "журнал записал изменение, которого в базе нет",
    );
  } finally {
    await db.end();
  }
});

Deno.test("F-019: несуществующая задача — ошибка, а не «обновлено»", async () => {
  await assertRejects(() =>
    updateTask("00000000-0000-0000-0000-000000000577", { title: "x" }, {
      actorTelegramId: ACTOR,
    })
  );
});

Deno.test("F-027: журнал и изменение — одна транзакция", async () => {
  const db = await connect();
  try {
    await seed(db);
    const id = await addTask(db, { due: "2026-10-05" });

    // Строка журнала без changed_by (NOT NULL) — вставка журнала падает. Изменение задачи
    // обязано откатиться вместе с ней.
    await assertRejects(() =>
      db.queryArray`select public.task_apply_update(
        ${id}::uuid,
        '{"title":"Новое"}'::jsonb,
        '{}'::jsonb,
        '[{"field":"title","old_value":"Задача","new_value":"Новое"}]'::jsonb)`
    );
    assertEquals((await row(db, id)).title, "Задача");
    assertEquals(await historyCount(db, id), 0);
  } finally {
    await db.end();
  }
});

Deno.test("ожидание не совпало — PT409, ничего не записано", async () => {
  const db = await connect();
  try {
    await seed(db);
    const id = await addTask(db, { due: "2026-10-05" });
    const err = await assertRejects(() =>
      db.queryArray`select public.task_apply_update(
        ${id}::uuid,
        '{"due_date":"2026-10-06"}'::jsonb,
        '{"due_date":"2026-01-01"}'::jsonb,
        '[]'::jsonb)`
    );
    assert(String(err).includes("changed concurrently"), String(err));
    assertEquals((await row(db, id)).due, "2026-10-05");
  } finally {
    await db.end();
  }
});

Deno.test("блокировка строки: второй писатель ждёт первого и видит его запись", async () => {
  const db = await connect();
  const a = await connect();
  const b = await connect();
  try {
    await seed(db);
    const id = await addTask(db, { due: "2026-10-05" });
    const call = (c: Client) =>
      c.queryArray`select public.task_apply_update(
        ${id}::uuid,
        '{"due_date":"2026-10-06"}'::jsonb,
        '{"due_date":"2026-10-05"}'::jsonb,
        '[{"field":"due_date","old_value":"2026-10-05","new_value":"2026-10-06","changed_by":"test"}]'::jsonb)`;

    // Первый писатель держит транзакцию открытой. Второй с тем же ожиданием обязан дождаться
    // и упасть на ожидании: без блокировки оба прочитали бы старый срок, и журнал получил бы
    // две строки на одно изменение (так и пропадало вхождение регулярной задачи).
    await a.queryArray`begin`;
    await call(a);
    const second = call(b).then(() => "ok", (e) => String(e));
    await new Promise((r) => setTimeout(r, 300));
    await a.queryArray`commit`;
    const outcome = await second;
    assert(
      outcome.includes("changed concurrently"),
      `второй писатель прошёл поверх первого: ${outcome}`,
    );
    assertEquals(await historyCount(db, id), 1);
  } finally {
    await a.end();
    await b.end();
    await db.end();
  }
});

Deno.test("функция не вызывается анонимно", async () => {
  const db = await connect();
  try {
    const r = await db.queryObject<{ anon: boolean; auth: boolean }>`
      select has_function_privilege('anon', 'public.task_apply_update(uuid, jsonb, jsonb, jsonb)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.task_apply_update(uuid, jsonb, jsonb, jsonb)', 'execute') as auth`;
    assertEquals(r.rows[0], { anon: false, auth: false });
  } finally {
    await db.end();
  }
});

Deno.test("F-018: повторное «готово» подряд не пропускает вхождение", async () => {
  const db = await connect();
  try {
    await seed(db);
    const today = todayInTz();
    const id = await addTask(db, { due: today, freq: "daily" });
    const next = nextOccurrence("daily", null, today, today)!;

    const first = await updateTask(id, { status: "done" }, {
      actorTelegramId: ACTOR,
    });
    assertEquals(first?.recurred, { from: today, to: next });

    // Второй клик / ретрай MCP после того, как первый уже записался.
    const second = await updateTask(id, { status: "done" }, {
      actorTelegramId: ACTOR,
    });
    assertEquals(
      second?.recurred,
      { from: today, to: next },
      "повтор должен вернуть тот же перекат, а не новый",
    );

    const r = await row(db, id);
    assertEquals(r.status, "open");
    assertEquals(r.due, next, "срок уехал ещё на период — вхождение пропущено");
    assertEquals(await historyCount(db, id), 1);
  } finally {
    await db.end();
  }
});

Deno.test("F-018: два одновременных «готово» — один перекат", async () => {
  const db = await connect();
  try {
    await seed(db);
    const today = todayInTz();
    const id = await addTask(db, { due: today, freq: "daily" });
    const next = nextOccurrence("daily", null, today, today)!;

    const results = await Promise.all([
      updateTask(id, { status: "done" }, { actorTelegramId: ACTOR }),
      updateTask(id, { status: "done" }, { actorTelegramId: ACTOR }),
    ]);
    for (const res of results) {
      assertEquals(res?.recurred, { from: today, to: next });
    }
    assertEquals((await row(db, id)).due, next);
    assertEquals(await historyCount(db, id), 1);

    // Строка переката — полноценная строка журнала: поле, кто, воркспейс.
    const h = await db.queryObject<
      { field: string; by: string; group_id: string }
    >`select field, changed_by_telegram_id::text as by, group_id from task_history where task_id = ${id}`;
    assertEquals(h.rows[0], { field: "status", by: String(ACTOR), group_id: WS });
  } finally {
    await db.end();
  }
});

Deno.test("обычная правка пишет журнал той же транзакцией", async () => {
  const db = await connect();
  try {
    await seed(db);
    const id = await addTask(db, { due: "2026-10-05" });
    await updateTask(id, { due_date: "2026-10-09", title: "Новое" }, {
      actorTelegramId: ACTOR,
    });
    const r = await row(db, id);
    assertEquals([r.due, r.title], ["2026-10-09", "Новое"]);
    assertEquals(await historyCount(db, id), 2);
  } finally {
    await db.end();
  }
});
