// Присутствие (#751) — функция presence_ping на НАСТОЯЩЕЙ базе.
//
// Ошибка здесь молчаливая: журнал либо разрастается строкой на каждый пульс (2 в минуту на
// человека) и тонет в шуме, либо теряет возвращения и смены разделов — и админ видит не то,
// что было. Держит это функция миграции 20261009140000_presence.sql.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const WS = "test-presence-751";
const TG = 900751001;

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с локальной базой (${DB_URL}): подними контур и сбрось базу. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return db;
}

async function cleanup(db: Client) {
  // presence и presence_log уносит каскад от воркспейса — так он и проверяется.
  await db.queryArray`delete from workspaces where id = ${WS}`;
}

async function ping(db: Client, section: string, state: string) {
  await db.queryArray`select public.presence_ping(${TG}::bigint, ${WS}, ${section}, ${state})`;
}

async function logRows(db: Client): Promise<string[]> {
  const { rows } = await db.queryArray<[string, string]>`
    select section, state from presence_log where telegram_id = ${TG} order by id`;
  return rows.map(([s, st]) => `${s}:${st}`);
}

Deno.test("присутствие: журнал пишет только смены и появления после паузы (#751)", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;

    // Под service_role, как пишет приложение: без EXECUTE и прав на таблицы пульс падал бы.
    await db.queryArray`set role service_role`;
    await ping(db, "tasks/mine/today", "active");
    await db.queryArray`reset role`;
    assertEquals(await logRows(db), ["tasks/mine/today:active"], "первое появление — в журнале");

    // Тот же раздел, то же состояние — строки нет, но «последний раз видели» обновился.
    await db
      .queryArray`update presence set last_seen_at = now() - interval '30 seconds', since = now() - interval '30 seconds' where telegram_id = ${TG}`;
    await ping(db, "tasks/mine/today", "active");
    assertEquals((await logRows(db)).length, 1, "повторный пульс того же — без строки");
    const { rows: [[fresh, sinceKept]] } = await db.queryArray<[boolean, boolean]>`
      select last_seen_at > now() - interval '5 seconds', since < now() - interval '20 seconds'
        from presence where telegram_id = ${TG}`;
    assert(fresh, "last_seen_at обновился");
    assert(sinceKept, "since не сдвинулся без смены");

    // Смена состояния и смена раздела — по строке.
    await ping(db, "tasks/mine/today", "idle");
    await ping(db, "meetings", "idle");
    assertEquals(await logRows(db), [
      "tasks/mine/today:active",
      "tasks/mine/today:idle",
      "meetings:idle",
    ]);

    // Пауза > 90 с: возвращение в тот же раздел — новое появление.
    await db.queryArray`update presence set last_seen_at = now() - interval '2 minutes' where telegram_id = ${TG}`;
    await ping(db, "meetings", "idle");
    assertEquals((await logRows(db)).length, 4, "появление после паузы — в журнале");

    // Пауза < 90 с — не появление.
    await db.queryArray`update presence set last_seen_at = now() - interval '60 seconds' where telegram_id = ${TG}`;
    await ping(db, "meetings", "idle");
    assertEquals((await logRows(db)).length, 4, "пауза короче 90 с — не появление");

    // Ушёл (вкладка скрыта) — смена; повторный away — без строки.
    await ping(db, "meetings", "away");
    await ping(db, "meetings", "away");
    const { rows: [[state, active]] } = await db.queryArray<[string, boolean]>`
      select state, active from presence where telegram_id = ${TG}`;
    assertEquals([state, active], ["away", false]);
    assertEquals((await logRows(db)).slice(-1), ["meetings:away"]);
    assertEquals((await logRows(db)).length, 5);

    // Неизвестное состояние — отказ, а не тихая запись.
    let refused = false;
    try {
      await ping(db, "meetings", "sleeping");
    } catch {
      refused = true;
    }
    assert(refused, "неизвестное состояние отбивается");

    // Чистка: строки старше суток уходят, свежие остаются.
    await db.queryArray`update presence_log set at = now() - interval '25 hours'
                         where telegram_id = ${TG} and state = 'active'`;
    await db.queryArray`set role service_role`;
    await db.queryArray`select public.presence_prune()`;
    await db.queryArray`reset role`;
    assertEquals((await logRows(db)).length, 4, "чистка снесла только старое");

    // Снаружи (anon) функцию не позвать.
    const { rows: [[anonCan]] } = await db.queryArray<[boolean]>`
      select has_function_privilege('anon', 'public.presence_ping(bigint, text, text, text)', 'execute')`;
    assertEquals(anonCan, false, "anon не зовёт presence_ping");

    // Каскад: удалили воркспейс — ушли и присутствие, и журнал.
    await cleanup(db);
    const { rows: [[left]] } = await db.queryArray<[bigint]>`
      select (select count(*) from presence where telegram_id = ${TG}) +
             (select count(*) from presence_log where telegram_id = ${TG})`;
    assertEquals(Number(left), 0);
  } finally {
    await db.queryArray`reset role`.catch(() => {});
    await cleanup(db).catch(() => {});
    await db.end();
  }
});
