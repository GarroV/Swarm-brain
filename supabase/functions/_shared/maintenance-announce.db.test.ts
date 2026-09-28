// Заморозка одним нажатием `public.maintenance_announce()` / `maintenance_cancel()` на
// НАСТОЯЩЕЙ базе (issue #609).
//
// Что здесь доказывается: уведомление получают люди рабочих воркспейсов и только они (демо —
// нет), повторное нажатие не плодит строк, а уже идущая заморозка от повтора не «оттаивает».
// Всё это живёт в SQL — в условиях отбора и в конфликте уникального индекса, поэтому мок
// проверил бы мою модель базы, а не базу.
//
// Тестовый контур общий: функция шлёт уведомление ВСЕМ людям стенда, поэтому проверки
// смотрят только на своих людей, а уборка снимает всё по ключу события. Строки app_settings
// сохраняются до прогона и возвращаются после — чужой прогон не должен увидеть нашу заморозку.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATION = new URL(
  "../../migrations/20260928200000_maintenance_announce.sql",
  import.meta.url,
);

const WS_A = "t_maint_a";
const WS_B = "t_maint_b";
const DEMO = "demo";
const USER_A = 800000611;
const USER_B = 800000612;
const USER_DEMO = 800000613; // живой человек, занесённый в демо: уведомление ему не положено
const USER_NOWS = 800000614; // без воркспейса: веба у него нет, строки в ленте тоже
const MINE = [USER_A, USER_B, USER_DEMO, USER_NOWS];
const KEYS = ["maintenance", "deploy_notice"];

async function connect(): Promise<Client> {
  const client = new Client(DB_URL);
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с тестовой базой (${DB_URL}). Запускай через ./scripts/with-local-db. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return client;
}

type Saved = { key: string; value: string }[];

async function setup(db: Client): Promise<Saved> {
  // Контур отстал от миграций (общий стенд, issue #595) — докатываем эту, идемпотентную. Если
  // функция уже есть, НЕ перенакатываем: иначе порча (scripts/porcha-sql) испорченную версию
  // тут же чинила бы обратно, и тест всегда проверял бы исправную.
  const has = await db.queryObject<{ ok: boolean }>(
    `select to_regprocedure('public.maintenance_cancel()') is not null as ok`,
  );
  if (!has.rows[0].ok) await db.queryArray(await Deno.readTextFile(MIGRATION));
  const saved = await db.queryObject<{ key: string; value: string }>(
    `select key, value::text as value from public.app_settings where key = any($1)`,
    [KEYS],
  );
  await db.queryArray(`delete from public.app_settings where key = any($1)`, [
    KEYS,
  ]);
  await db.queryArray(
    `insert into public.workspaces (id, name) values ($1, $1), ($2, $2), ($3, 'Demo')
       on conflict (id) do nothing`,
    [WS_A, WS_B, DEMO],
  );
  await db.queryArray(
    `insert into public.allowed_users (telegram_id, username, added_by, group_id) values
       ($1, 't_maint_a', 1, $5), ($2, 't_maint_b', 1, $6), ($3, 't_maint_demo', 1, $7),
       ($4, 't_maint_nows', 1, null)
     on conflict (telegram_id) do update set group_id = excluded.group_id`,
    [USER_A, USER_B, USER_DEMO, USER_NOWS, WS_A, WS_B, DEMO],
  );
  return saved.rows;
}

async function teardown(db: Client, saved: Saved) {
  // Уведомления о заморозке на тестовом контуре кладёт только эта функция — снимаем все,
  // включая строки чужих людей стенда: рассылка идёт всем.
  await db.queryArray(
    `delete from public.notifications where type = 'maintenance'`,
  );
  await db.queryArray(
    `delete from public.notifications where recipient_telegram_id = any($1)`,
    [MINE],
  );
  await db.queryArray(`delete from public.app_settings where key = any($1)`, [
    KEYS,
  ]);
  for (const r of saved) {
    await db.queryArray(
      `insert into public.app_settings (key, value) values ($1, $2::jsonb)`,
      [r.key, r.value],
    );
  }
  await db.queryArray(
    `delete from public.allowed_users where telegram_id = any($1)`,
    [MINE],
  );
  await db.queryArray(`delete from public.workspaces where id in ($1, $2)`, [
    WS_A,
    WS_B,
  ]);
}

/** Прогон на базе: подготовка, тело, уборка — даже если тело упало. */
async function scenario(fn: (db: Client) => Promise<void>) {
  const db = await connect();
  let saved: Saved = [];
  try {
    saved = await setup(db);
    await fn(db);
  } finally {
    await teardown(db, saved);
    await db.end();
  }
}

type Row = {
  recipient: string;
  group_id: string | null;
  read_at: Date | null;
  payload: Record<string, unknown>;
};

async function myRows(db: Client): Promise<Row[]> {
  const r = await db.queryObject<Row>(
    `select recipient_telegram_id::text as recipient, group_id, read_at, payload
       from public.notifications
      where type = 'maintenance' and recipient_telegram_id = any($1)
      order by recipient_telegram_id`,
    [MINE],
  );
  return r.rows;
}

async function announce(
  db: Client,
  lead: number,
  dur: number,
  en = "",
  ru = "",
) {
  const r = await db.queryObject<{ res: Record<string, string> }>(
    `select public.maintenance_announce($1, $2, $3, $4) as res`,
    [lead, dur, en, ru],
  );
  return r.rows[0].res;
}

async function setting(db: Client, key: string) {
  const r = await db.queryObject<{ value: Record<string, string> }>(
    `select value from public.app_settings where key = $1`,
    [key],
  );
  return r.rows[0]?.value ?? null;
}

Deno.test("maintenance_announce: уведомление получают рабочие воркспейсы, демо и люди без воркспейса — нет", async () => {
  await scenario(async (db) => {
    const res = await announce(db, 15, 30, "Moving house", "Переезд");
    const rows = await myRows(db);
    assertEquals(
      rows.map((r) => [r.recipient, r.group_id]),
      [[String(USER_A), WS_A], [String(USER_B), WS_B]],
    );
    const p = rows[0].payload;
    assertEquals(p.id, res.id);
    assertEquals(p.message_en, "Moving house");
    assertEquals(p.message_ru, "Переезд");
    const span = Date.parse(String(p.until)) - Date.parse(String(p.starts_at));
    assertEquals(span, 30 * 60_000);
    const lead = Date.parse(String(p.starts_at)) - Date.now();
    assert(
      lead > 13 * 60_000 && lead <= 15 * 60_000,
      `начало через ${lead} мс`,
    );
  });
});

Deno.test("maintenance_announce: плашка и заморозка ложатся вместе, заморозка ждёт начала", async () => {
  await scenario(async (db) => {
    const res = await announce(db, 10, 20);
    const m = await setting(db, "maintenance");
    const n = await setting(db, "deploy_notice");
    assert(m && n, "обе строки должны появиться");
    assertEquals(m.id, res.id);
    assertEquals(Date.parse(m.starts_at), Date.parse(res.starts_at));
    assert(
      Date.parse(m.starts_at) > Date.now(),
      "заморозка ещё не должна действовать",
    );
    assert(m.message_en.length > 0 && m.message_ru.length > 0);
    assertEquals(n.kind, "freeze");
    assertEquals(Date.parse(n.at), Date.parse(m.starts_at));
    assertEquals(Date.parse(n.until), Date.parse(m.until));
  });
});

Deno.test("maintenance_announce: повторное нажатие — та же заморозка, без второй строки у человека", async () => {
  await scenario(async (db) => {
    const first = await announce(db, 15, 30);
    await db.queryArray(
      `update public.notifications set read_at = now() where recipient_telegram_id = $1 and type = 'maintenance'`,
      [USER_A],
    );
    const same = await announce(db, 15, 30);
    assertEquals(same.id, first.id);
    let rows = await myRows(db);
    assertEquals(rows.length, 2);
    assert(rows[0].read_at, "то же событие не должно снова стать непрочитанным");

    // Перенесли время — строка та же, но снова непрочитанная: прежнее время уже неправда.
    const moved = await announce(db, 40, 30);
    assertEquals(moved.id, first.id);
    rows = await myRows(db);
    assertEquals(rows.length, 2);
    assertEquals(rows[0].read_at, null);
    assertEquals(
      Date.parse(String(rows[0].payload.starts_at)),
      Date.parse(moved.starts_at),
    );
  });
});

Deno.test("maintenance_announce: повтор во время идущей заморозки не сдвигает начало, а продлевает конец", async () => {
  await scenario(async (db) => {
    const first = await announce(db, 0, 10);
    assert(Date.parse(first.starts_at) <= Date.now(), "с нулём — сразу");
    const again = await announce(db, 15, 60);
    assertEquals(again.id, first.id);
    assertEquals(Date.parse(again.starts_at), Date.parse(first.starts_at));
    assert(Date.parse(again.until) > Date.parse(first.until));
  });
});

Deno.test("maintenance_cancel: снимает заморозку и свою плашку, уведомления помечает, а не удаляет", async () => {
  await scenario(async (db) => {
    const res = await announce(db, 15, 30);
    const out = await db.queryObject<{ res: Record<string, unknown> }>(
      "select public.maintenance_cancel() as res",
    );
    assertEquals(out.rows[0].res.id, res.id);
    assertEquals(await setting(db, "maintenance"), null);
    assertEquals(await setting(db, "deploy_notice"), null);
    const rows = await myRows(db);
    assertEquals(rows.length, 2);
    assert(rows.every((r) => typeof r.payload.cancelled_at === "string"));

    // Объявление о ночной раскатке — чужая плашка: снятие заморозки её не трогает.
    await db.queryArray(
      `insert into public.app_settings (key, value) values ('deploy_notice',
         jsonb_build_object('at', now() + interval '5 minutes', 'until', now() + interval '25 minutes'))`,
    );
    await db.queryArray("select public.maintenance_cancel()");
    assert(
      await setting(db, "deploy_notice"),
      "плашку раскатки сняли вместе с заморозкой",
    );

    // Новая заморозка после снятой — новое событие с новой строкой у человека.
    const next = await announce(db, 15, 30);
    assert(next.id !== res.id);
    assertEquals((await myRows(db)).length, 4);
  });
});

Deno.test("maintenance_announce: срок ограничен, чужим ролям вызов закрыт", async () => {
  await scenario(async (db) => {
    await assertRejects(() => announce(db, 0, 181), Error, "длительность");
    await assertRejects(() => announce(db, -1, 30), Error, "начало");
    for (const role of ["anon", "authenticated"]) {
      for (
        const fn of [
          "public.maintenance_announce(integer, integer, text, text)",
          "public.maintenance_cancel()",
        ]
      ) {
        const p = await db.queryObject<{ ok: boolean }>(
          `select has_function_privilege('${role}', '${fn}', 'execute') as ok`,
        );
        assertEquals(p.rows[0].ok, false, `${role} может вызвать ${fn}`);
      }
    }
  });
});
