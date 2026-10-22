// Наследство автоматики 19.10.2026 на НАСТОЯЩЕЙ базе (контур, который выберет scripts/with-local-db).
// Старый триггер срока, сдвинув срок за конец идущего, ставил строке идущего пометку «к переносу»
// (`to_carry`, `carry_auto`) и заводил задаче строку в запланированном спринте срока. Новый триггер
// (20261022121000) видит такую пару как «план из двух спринтов» и ведёт её неверно: срок вернули —
// строка в запланированном остаётся; срок сдвинули дальше — план «продлевается».
// `sprint_convert_legacy_carry()` (миграция 20261022123000) превращает пару в настоящий перенос:
// источник — снимок, строка в запланированном — цель.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
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

const WS = "t_sprint_legacy";

interface Scene {
  today: string;
  /** P — принятый прошлый, A — идущий, F1/F2 — запланированные. */
  P: string;
  A: string;
  F1: string;
  F2: string;
}

async function build(db: Client): Promise<Scene> {
  await db.queryArray`delete from task_history where group_id = ${WS}`;
  await db
    .queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${WS})`;
  await db.queryArray`delete from sprint_cycles where group_id = ${WS}`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from sprints where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.queryArray`insert into workspaces (id, name) values (${WS}, 'Тестовый')`;
  const t = (await db.queryObject<{ d: string }>`select current_date::text as d`).rows[0].d;
  const tab = (await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active', 'space')
    returning id`).rows[0].id;
  const cycle = async (name: string, from: number, to: number, status: string) =>
    (await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
      values (${WS}, ${tab}, ${name}, ${addDays(t, from)}, ${addDays(t, to)}, ${addDays(t, from + 6)}, ${status})
      returning id`).rows[0].id;
  return {
    today: t,
    P: await cycle("Спринт 3", -19, -6, "accepted"),
    A: await cycle("Спринт 4", -5, 8, "active"),
    F1: await cycle("Спринт 5", 9, 22, "draft"),
    F2: await cycle("Спринт 6", 23, 36, "draft"),
  };
}

async function addTask(db: Client, due: string, status = "open"): Promise<string> {
  return (await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, created_by, due_date)
    values ('задача из старой автоматики', ${status}, ${WS}, 'test', ${due}) returning id`).rows[0].id;
}

/** Пара ровно как оставлял старый триггер: пометка без причины в идущем + строка в спринте срока. */
async function legacyPair(db: Client, s: Scene, taskId: string, auto = true) {
  const src = (await db.queryObject<{ id: string }>`
    insert into sprint_items (cycle_id, task_id, in_plan, to_carry, carry_auto, carry_at, carry_by, carry_count)
    values (${s.A}, ${taskId}, true, true, ${auto}, now() - interval '2 days', ${auto ? null : "777"}, 1)
    returning id`).rows[0].id;
  const target = (await db.queryObject<{ id: string }>`
    insert into sprint_items (cycle_id, task_id, in_plan, added_by)
    values (${s.F1}, ${taskId}, true, null) returning id`).rows[0].id;
  return { src, target };
}

interface Row {
  id: string;
  cycle_id: string;
  carried_from: string | null;
  carry_count: number;
  to_carry: boolean;
  carry_reason: string | null;
  moved_at: string | null;
  moved_to: string | null;
  moved_by: string | null;
  frozen_title: string | null;
  frozen_due_date: string | null;
  auto_extended: boolean;
}

async function rows(db: Client, taskId: string): Promise<Row[]> {
  return (await db.queryObject<Row>`
    select id, cycle_id, carried_from, carry_count, to_carry, carry_reason, moved_at::text, moved_to, moved_by,
           frozen_title, frozen_due_date::text, auto_extended
      from sprint_items where task_id = ${taskId} order by id`).rows;
}

const convert = (db: Client) => db.queryObject<{ n: number }>`select public.sprint_convert_legacy_carry() as n`;

async function withScene(fn: (db: Client, s: Scene) => Promise<void>) {
  const db = await connect();
  try {
    await fn(db, await build(db));
  } finally {
    await db.end();
  }
}

Deno.test("старая авто-пометка с строкой в спринте срока становится переносом: снимок + цель", async () => {
  await withScene(async (db, s) => {
    const due = addDays(s.today, 15);
    const taskId = await addTask(db, due);
    const { src, target } = await legacyPair(db, s, taskId);

    const n = (await convert(db)).rows[0].n;
    assert(n >= 1, `преобразовано: ${n}`);

    const all = await rows(db, taskId);
    const snap = all.find((x) => x.id === src)!;
    const goal = all.find((x) => x.id === target)!;
    assert(snap.moved_at !== null, "источник — снимок");
    assertEquals(snap.moved_to, target);
    assertEquals(snap.moved_by, null, "перенесла автоматика");
    assertEquals(snap.to_carry, false);
    assertEquals(snap.carry_reason, null, "причины нет — снимок красный");
    assertEquals(snap.frozen_title, "задача из старой автоматики");
    assertEquals(snap.frozen_due_date, due);
    assertEquals(goal.carried_from, src);
    assertEquals(goal.carry_count, 2);
    assertEquals(goal.moved_at, null);
    const task = (await db.queryObject<{ due: string }>`
      select due_date::text as due from tasks where id = ${taskId}`).rows[0];
    assertEquals(task.due, due, "срок задачи не тронут");

    // Повторный прогон ничего не меняет.
    const before = JSON.stringify(await rows(db, taskId));
    await convert(db);
    assertEquals(JSON.stringify(await rows(db, taskId)), before);
  });
});

Deno.test("после преобразования срок вернули в идущий: снимок оживает, строки в запланированном нет", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, addDays(s.today, 15));
    const { src } = await legacyPair(db, s, taskId);
    await convert(db);
    await db.queryArray`update tasks set due_date = ${addDays(s.today, 4)}::date where id = ${taskId}`;
    const all = await rows(db, taskId);
    assertEquals(all.map((x) => x.id), [src], "задача в одном спринте — идущем");
    assertEquals(all[0].moved_at, null);
  });
});

Deno.test("после преобразования срок сдвинули дальше: задача переезжает, план не «продлевается»", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, addDays(s.today, 15));
    const { src, target } = await legacyPair(db, s, taskId);
    await convert(db);
    await db.queryArray`update tasks set due_date = ${addDays(s.today, 30)}::date where id = ${taskId}`;
    const all = await rows(db, taskId);
    assertEquals(all.filter((x) => x.auto_extended).length, 0, "строк продления нет");
    const live = all.filter((x) => x.moved_at === null);
    assertEquals(live.map((x) => [x.id, x.cycle_id]), [[target, s.F2]], "цель переставлена в спринт срока");
    assertEquals(all.find((x) => x.id === src)!.moved_to, target, "ссылка снимка не порвалась");
  });
});

Deno.test("не трогает: ручную пометку, авто-пометку без строки в запланированном, закрытую задачу, план человека, прошлый спринт", async () => {
  await withScene(async (db, s) => {
    const manual = await addTask(db, addDays(s.today, 15));
    await legacyPair(db, s, manual, false);
    const lonely = await addTask(db, addDays(s.today, 15));
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan, to_carry, carry_auto)
      values (${s.A}, ${lonely}, true, true, true)`;
    const done = await addTask(db, addDays(s.today, 15), "done");
    await legacyPair(db, s, done);
    // Строку в запланированном положил человек — это план, а не след старой автоматики.
    const planned = await addTask(db, addDays(s.today, 15));
    const p = await legacyPair(db, s, planned);
    await db.queryArray`update sprint_items set added_by = '777' where id = ${p.target}`;
    // Вторая строка задачи — в ПРИНЯТОМ прошлом спринте: цель переноса только запланированный.
    const past = await addTask(db, addDays(s.today, 15));
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan, to_carry, carry_auto)
      values (${s.A}, ${past}, true, true, true), (${s.P}, ${past}, true, false, false)`;

    const all = () => Promise.all([manual, lonely, done, planned, past].map((id) => rows(db, id)));
    const before = JSON.stringify(await all());
    await convert(db);
    assertEquals(JSON.stringify(await all()), before);
  });
});

Deno.test("преобразование вызывает только service_role", async () => {
  const db = await connect();
  try {
    const r = await db.queryObject<{ anon: boolean; auth: boolean; svc: boolean }>`
      select has_function_privilege('anon', 'public.sprint_convert_legacy_carry()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.sprint_convert_legacy_carry()', 'execute') as auth,
             has_function_privilege('service_role', 'public.sprint_convert_legacy_carry()', 'execute') as svc`;
    assertEquals(r.rows[0], { anon: false, auth: false, svc: true });
  } finally {
    await db.end();
  }
});
