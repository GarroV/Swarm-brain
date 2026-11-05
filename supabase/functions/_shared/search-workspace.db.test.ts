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

// ── Общая встреча двух пространств (этап 2, миграция 20261105180000) ─────────────────────
// Поиск идёт по признаку принадлежности: встреча с домом в WS и признаком {WS, OTHER_WS}
// находится из OTHER_WS; не общая и личная — нет.

const SHARED_WORD = "qzxwsharedscope";

async function seedShared(db: Client) {
  await seed(db);
  const meeting = (title: string, visible: string[], isPrivate: boolean) =>
    db.queryArray`
      insert into entries (content, entry_type, source, added_by, is_private, owner_id, metadata, group_id,
        visible_group_ids, countries)
      values (${`${SHARED_WORD} ${title}`}, 'meeting', 'test', 'test', ${isPrivate}, 111,
        ${JSON.stringify({ title, confirmed: true })}::jsonb, ${WS}, ${visible}, array['RS'])`;
  await meeting("shared", [WS, OTHER_WS], false);
  await meeting("home-only", [WS], false);
  await meeting("private-shared", [WS, OTHER_WS], true);
}

async function sharedTitles(db: Client, groupId: string, userId: number | null): Promise<string[]> {
  const r = await db.queryObject<{ title: string }>`
    select metadata->>'title' as title from public.match_entries_hybrid(
      query_embedding => ${EMBEDDING}, query_text => ${SHARED_WORD}, match_count => 15,
      requesting_user_id => ${userId}, filter_group_id => ${groupId}, filter_since => null::date)`;
  return r.rows.map((x) => x.title).sort();
}

Deno.test("общая встреча: вторая команда находит её поиском, не общую и чужую личную — нет", async () => {
  const db = await connect();
  try {
    await seedShared(db);
    assertEquals(await sharedTitles(db, OTHER_WS, 999), ["shared"]);
    // Дома видно всё общее, а личную — только владельцу.
    assertEquals(await sharedTitles(db, WS, 999), ["home-only", "shared"]);
    assertEquals(await sharedTitles(db, OTHER_WS, 111), ["private-shared", "shared"]);
  } finally {
    await db.end();
  }
});

Deno.test("общая встреча: поиск по стране тоже идёт по признаку принадлежности", async () => {
  const db = await connect();
  try {
    await seedShared(db);
    const r = await db.queryObject<{ content: string }>`
      select content from public.search_entries_by_country('RS', ${OTHER_WS}, 999)`;
    const found = r.rows.map((x) => x.content).filter((c) => c.includes(SHARED_WORD));
    assertEquals(found, [`${SHARED_WORD} shared`]);
    const none = await db.queryObject`select 1 from public.search_entries_by_country('RS', null, 999)`;
    assertEquals(none.rows.length, 0);
  } finally {
    await db.end();
  }
});

// ── Триггер инварианта признака ──────────────────────────────────────────────────────────

Deno.test("признак: не-встречу расширить нельзя, домашнее всегда в массиве", async () => {
  const db = await connect();
  try {
    await seed(db);
    const note = await db.queryObject<{ id: string; v: string[] }>`
      insert into entries (content, entry_type, source, added_by, is_private, metadata, group_id, visible_group_ids)
      values ('note-share', 'note', 'test', 'test', false, '{}'::jsonb, ${WS}, ${[OTHER_WS]})
      returning id, visible_group_ids as v`;
    assertEquals(note.rows[0].v, [WS], "заметка не должна делиться с другим пространством");

    const upd = await db.queryObject<{ v: string[] }>`
      update entries set visible_group_ids = ${[WS, OTHER_WS]} where id = ${note.rows[0].id}
      returning visible_group_ids as v`;
    assertEquals(upd.rows[0].v, [WS], "UPDATE тоже не расширяет не-встречу");

    const meeting = await db.queryObject<{ id: string; v: string[] }>`
      insert into entries (content, entry_type, source, added_by, is_private, metadata, group_id, visible_group_ids)
      values ('meeting-share', 'meeting', 'test', 'test', false, '{}'::jsonb, ${WS}, ${[OTHER_WS, OTHER_WS]})
      returning id, visible_group_ids as v`;
    assertEquals(meeting.rows[0].v, [WS, OTHER_WS].sort(), "домашнее добавляется, повторы убираются");

    const dropHome = await db.queryObject<{ v: string[] }>`
      update entries set visible_group_ids = ${[OTHER_WS]} where id = ${meeting.rows[0].id}
      returning visible_group_ids as v`;
    assertEquals(dropHome.rows[0].v, [WS, OTHER_WS].sort(), "домашнее из массива не убрать");

    const plain = await db.queryObject<{ v: string[] }>`
      insert into entries (content, entry_type, source, added_by, is_private, metadata, group_id)
      values ('meeting-default', 'meeting', 'test', 'test', false, '{}'::jsonb, ${WS})
      returning visible_group_ids as v`;
    assertEquals(plain.rows[0].v, [WS], "без признака встреча видна только дома");
  } finally {
    await db.end();
  }
});

Deno.test("признак: триггерную функцию не вызвать от anon/authenticated", async () => {
  const db = await connect();
  try {
    const r = await db.queryObject<{ anon: boolean; auth: boolean }>`
      select has_function_privilege('anon', 'public.entries_visible_group_ids_ensure()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.entries_visible_group_ids_ensure()', 'execute') as auth`;
    assertEquals(r.rows[0], { anon: false, auth: false });
  } finally {
    await db.end();
  }
});
