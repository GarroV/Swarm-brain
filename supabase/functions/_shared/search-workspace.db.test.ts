// Гибридный поиск требует воркспейс — на НАСТОЯЩЕЙ базе. Ошибка здесь не падает: пропущенный
// `filter_group_id` молча даёт выдачу из записей всех воркспейсов.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const WS = "t_search_ws";
const OTHER_WS = "t_search_ws_other";
const WORD = "qzxwsearchscope";
const EMBEDDING = "[1,0,0]";

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
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from entries where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
    await db.queryArray`
      insert into entries (content, entry_type, source, added_by, is_private, metadata, group_id)
      values (${`${WORD} запись ${ws}`}, 'note', 'test', 'test', false, '{}'::jsonb, ${ws})`;
  }
}

/** Вызов 15-аргументной перегрузки: `filter_since` задан, поэтому выбор перегрузки однозначен. */
async function search(db: Client, groupId: string | null): Promise<string[]> {
  const r = await db.queryObject<{ group_id: string }>`
    select group_id from public.match_entries_hybrid(
      query_embedding => ${EMBEDDING}, query_text => ${WORD}, match_count => 15,
      filter_group_id => ${groupId}, filter_since => null::date)`;
  return r.rows.map((x) => x.group_id);
}

Deno.test("поиск: без воркспейса не находит ничего, даже при совпадении текста", async () => {
  const db = await connect();
  try {
    await seed(db);
    assertEquals(await search(db, null), []);
  } finally {
    await db.end();
  }
});

Deno.test("поиск: с воркспейсом находит только его записи", async () => {
  const db = await connect();
  try {
    await seed(db);
    assertEquals(await search(db, WS), [WS]);
    assertEquals(await search(db, OTHER_WS), [OTHER_WS]);
  } finally {
    await db.end();
  }
});

Deno.test("поиск: обе перегрузки не содержат ветки «воркспейс не задан — искать везде»", async () => {
  const db = await connect();
  try {
    const r = await db.queryObject<{ src: string }>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'match_entries_hybrid'`;
    assertEquals(r.rows.length, 2, "ожидались две перегрузки match_entries_hybrid");
    for (const { src } of r.rows) {
      assert(!src.includes("filter_group_id is null"), "в теле осталась ветка поиска по всем воркспейсам");
    }
  } finally {
    await db.end();
  }
});
