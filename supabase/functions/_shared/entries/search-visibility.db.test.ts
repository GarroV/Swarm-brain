// Личная запись на двоих (#641) в SQL-поиске: правило видимости живёт в коде
// (_shared/entries/access.ts) И в SQL-функциях поиска — match_entries и match_entries_hybrid (миграция 20261001120000). Разойтись они могут молча: второй участник
// просто перестанет находить свою встречу, а третий — начнёт находить чужую. Юнит-тест кода
// этого не увидит, поэтому спрашиваем живую базу.
//
// Тест падает на ЧУЖОМ: третий человек обязан получить пусто во всех трёх функциях.
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const OWNER = 900111;
const PARTNER = -900222; // веб-пользователь без Telegram: отрицательный id — живой человек
const THIRD = 900333;
const TOKEN = "zxqvshared641";

const WS = "test-641";

// owner_id ссылается на allowed_users, поэтому владелец заводится настоящей строкой (в своём
// тестовом воркспейсе) и убирается вместе с записью. shared_with внешнего ключа не имеет.
async function withSharedEntry(fn: (db: Client, id: string) => Promise<void>): Promise<void> {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await db.queryArray`delete from entries where group_id = ${WS}`;
    await db.queryArray`delete from allowed_users where telegram_id = ${OWNER}`;
    await db.queryArray`delete from workspaces where id = ${WS}`;
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${OWNER}, ${"u" + OWNER}, 0, ${WS})`;
    const ins = await db.queryObject<{ id: string }>`
      insert into entries (content, summary, entry_type, source, added_by, is_private, owner_id,
                           shared_with, embedding, metadata, group_id)
      values (${"Встреча " + TOKEN}, ${TOKEN}, 'meeting', 'test', 'test', true, ${OWNER},
              ${[PARTNER]}::bigint[], '[1,0,0]'::vector, '{"confirmed": true}'::jsonb, ${WS})
      returning id`;
    await fn(db, ins.rows[0].id);
  } finally {
    await db.queryArray`delete from entries where group_id = ${WS}`;
    await db.queryArray`delete from allowed_users where telegram_id = ${OWNER}`;
    await db.queryArray`delete from workspaces where id = ${WS}`;
    await db.end();
  }
}

async function found(db: Client, id: string, viewer: number): Promise<Record<string, boolean>> {
  const me = await db.queryObject<{ n: number }>`
    select count(*)::int as n from match_entries('[1,0,0]', 0.0, 50, ${viewer}) where id = ${id}`;
  // Перегрузка без filter_since вызовом не различима (те же первые аргументы, остальные с
  // дефолтом), приложение всегда шлёт filter_since — проверяем ту, что работает. Обе текста
  // правила миграция меняет одинаково.
  const since = await db.queryObject<{ n: number }>`
    select count(*)::int as n from match_entries_hybrid('[1,0,0]', ${TOKEN}, 30, ${viewer},
      filter_since => '2000-01-01'::date) where id = ${id}`;
  return { match_entries: me.rows[0].n > 0, hybrid: since.rows[0].n > 0 };
}

const all = (v: boolean) => ({ match_entries: v, hybrid: v });

Deno.test("поиск: запись на двоих находит владелец", async () => {
  await withSharedEntry(async (db, id) => assertEquals(await found(db, id, OWNER), all(true)));
});

Deno.test("поиск: запись на двоих находит второй участник", async () => {
  await withSharedEntry(async (db, id) => assertEquals(await found(db, id, PARTNER), all(true)));
});

Deno.test("поиск: третий человек запись на двоих НЕ находит ни одной функцией", async () => {
  await withSharedEntry(async (db, id) => assertEquals(await found(db, id, THIRD), all(false)));
});
