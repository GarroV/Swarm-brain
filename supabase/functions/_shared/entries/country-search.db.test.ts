// Нечёткий поиск по стране для ассистента бота — search_entries_by_country (миграция
// 20261001120000). Решение владельца 01.10.2026: бот «должен уметь» искать по стране, но
// прежняя сигнатура не знала ни воркспейса, ни смотрящего. Тест падает на ЧУЖОМ: чужая личная
// запись и запись другого воркспейса не должны находиться, а вызвать функцию может только
// service_role.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const WS = "test-641c";
const OTHER_WS = "test-641d";
const ME = 900441;
const COLLEAGUE = 900442;
const TAG = "ZQ641X";
const QUERY = "q641"; // нечёткое: часть тега в другом регистре

async function withFixture(fn: (db: Client, ids: Record<string, string>) => Promise<void>): Promise<void> {
  const db = new Client(DB_URL);
  await db.connect();
  const clean = async () => {
    await db.queryArray`delete from entries where group_id in (${WS}, ${OTHER_WS})`;
    await db.queryArray`delete from allowed_users where telegram_id in (${ME}, ${COLLEAGUE})`;
    await db.queryArray`delete from workspaces where id in (${WS}, ${OTHER_WS})`;
  };
  try {
    await clean();
    for (const ws of [WS, OTHER_WS]) {
      await db.queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
    }
    for (const person of [ME, COLLEAGUE]) {
      await db.queryArray`
        insert into allowed_users (telegram_id, username, added_by, group_id)
        values (${person}, ${"u" + person}, 0, ${WS})`;
    }
    const add = async (
      ws: string,
      isPrivate: boolean,
      owner: number,
      sharedWith: number[],
    ): Promise<string> => {
      const r = await db.queryObject<{ id: string }>`
        insert into entries (content, summary, entry_type, source, added_by, is_private, owner_id,
                             shared_with, countries, group_id)
        values ('x', 'x', 'note', 'test', 'test', ${isPrivate}, ${owner}, ${sharedWith}::bigint[],
                ${[TAG]}::text[], ${ws})
        returning id`;
      return r.rows[0].id;
    };
    const ids = {
      mine: await add(WS, true, ME, []),
      team: await add(WS, false, COLLEAGUE, []),
      sharedWithMe: await add(WS, true, COLLEAGUE, [ME]),
      colleaguePrivate: await add(WS, true, COLLEAGUE, []),
      otherWorkspace: await add(OTHER_WS, false, COLLEAGUE, []),
    };
    await fn(db, ids);
  } finally {
    await clean();
    await db.end();
  }
}

async function found(db: Client, group: string | null, viewer: number | null): Promise<Set<string>> {
  const r = await db.queryObject<{ id: string }>`
    select id from search_entries_by_country(${QUERY}, ${group}, ${viewer})`;
  return new Set(r.rows.map((x) => x.id));
}

Deno.test("поиск по стране: своя личная, общая и разделённая со мной находятся", async () => {
  await withFixture(async (db, ids) => {
    const got = await found(db, WS, ME);
    assert(got.has(ids.mine), "своя личная");
    assert(got.has(ids.team), "общая");
    assert(got.has(ids.sharedWithMe), "встреча на двоих");
  });
});

Deno.test("поиск по стране: чужая личная и другой воркспейс НЕ находятся", async () => {
  await withFixture(async (db, ids) => {
    const got = await found(db, WS, ME);
    assertEquals(got.has(ids.colleaguePrivate), false, "чужая личная");
    assertEquals(got.has(ids.otherWorkspace), false, "другой воркспейс");
  });
});

Deno.test("поиск по стране: без воркспейса пусто, без смотрящего — только общие", async () => {
  await withFixture(async (db, ids) => {
    assertEquals((await found(db, null, ME)).size, 0);
    assertEquals([...await found(db, WS, null)], [ids.team]);
  });
});

Deno.test("поиск по стране: вызвать может только service_role, старой сигнатуры нет", async () => {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    const sig = "public.search_entries_by_country(text, text, bigint)";
    const r = await db.queryObject<{ anon: boolean; auth: boolean; svc: boolean; old: string | null }>`
      select has_function_privilege('anon', ${sig}, 'execute') as anon,
             has_function_privilege('authenticated', ${sig}, 'execute') as auth,
             has_function_privilege('service_role', ${sig}, 'execute') as svc,
             to_regprocedure('public.search_entries_by_country(text)')::text as old`;
    assertEquals(r.rows[0], { anon: false, auth: false, svc: true, old: null });
  } finally {
    await db.end();
  }
});
