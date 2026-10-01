// Архивная встреча не видна нигде (#569) — на НАСТОЯЩЕЙ базе.
//
// Проверка готовности из задачи: «архивная встреча не видна ни в поиске, ни в MCP, ни в боте, ни
// в дайджесте». Поиск живёт в SQL (match_entries, match_entries_hybrid, search_entries_by_country) —
// юнит-тест кода его не увидит, поэтому спрашиваем живую базу. Выборки в коде держит сторож
// live.guard.test.ts; здесь — что сама архивация доходит до базы: запись остаётся строкой, задачи
// встречи уходят в архив, а не стираются (#687), гард записи отдаёт 404.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";
import { createClient } from "@supabase/supabase-js";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const { archiveEntry } = await import("./archive.ts");
const { getEntrySecure, buildEntriesQuery } = await import("../../swarm-api/entries-guard.ts");

const WS = "test-569";
const OWNER = 900569;
const TOKEN = "zxqvarchive569";
const TAG = "ZQ569X";
const SOURCE_MEETING = "src-meeting-569";

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

async function clean(db: Client) {
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from entries where group_id = ${WS}`;
  await db.queryArray`delete from allowed_users where telegram_id = ${OWNER}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
}

/** Общая подтверждённая встреча с эмбеддингом, тегом страны и двумя задачами (по обоим ключам). */
async function withMeeting(fn: (db: Client, id: string) => Promise<void>): Promise<void> {
  const db = await connect();
  try {
    await clean(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${OWNER}, ${"u" + OWNER}, 0, ${WS})`;
    const ins = await db.queryObject<{ id: string }>`
      insert into entries (content, summary, entry_type, source, added_by, is_private, owner_id,
                           embedding, countries, metadata, group_id)
      values (${"Встреча " + TOKEN}, ${TOKEN}, 'meeting', 'test', 'test', false, ${OWNER},
              '[1,0,0]'::vector, ${[TAG]}::text[],
              ${JSON.stringify({ confirmed: true, meeting_id: SOURCE_MEETING })}::jsonb, ${WS})
      returning id`;
    const id = ins.rows[0].id;
    await db.queryArray`
      insert into tasks (title, status, group_id, meeting_id, created_by)
      values ('из веба', 'open', ${WS}, ${id}, 'test'), ('из бота', 'open', ${WS}, ${SOURCE_MEETING}, 'test')`;
    await fn(db, id);
  } finally {
    await clean(db);
    await db.end();
  }
}

async function foundBySearch(db: Client, id: string): Promise<Record<string, boolean>> {
  const me = await db.queryObject<{ n: number }>`
    select count(*)::int as n from match_entries('[1,0,0]', 0.0, 50, ${OWNER}) where id = ${id}`;
  const hybrid = await db.queryObject<{ n: number }>`
    select count(*)::int as n from match_entries_hybrid('[1,0,0]', ${TOKEN}, 30, ${OWNER},
      filter_since => '2000-01-01'::date) where id = ${id}`;
  // Перегрузку без filter_since вызовом не различить (та же голова, остальные аргументы с дефолтами —
  // вызов неоднозначен), поэтому для неё проверяем текст: условие обязано стоять в ОБЕИХ ветках.
  const old = await db.queryObject<{ n: number }>`
    select (length(prosrc) - length(replace(prosrc, 'e.archived_at is null', ''))) / length('e.archived_at is null') as n
    from pg_proc
    where oid = 'public.match_entries_hybrid(text,text,integer,bigint,text,text,text,double precision,double precision,double precision,double precision,integer,integer,integer)'::regprocedure`;
  const country = await db.queryObject<{ n: number }>`
    select count(*)::int as n from search_entries_by_country(${TAG.toLowerCase()}, ${WS}, ${OWNER}) where id = ${id}`;
  return {
    match_entries: me.rows[0].n > 0,
    hybrid: hybrid.rows[0].n > 0,
    // Текст перегрузки один и тот же у живой и архивной: условие есть → архив отсечён.
    hybrid_old_filters_archive: Number(old.rows[0].n) === 2,
    by_country: country.rows[0].n > 0,
  };
}

const everywhere = (v: boolean) => ({ match_entries: v, hybrid: v, hybrid_old_filters_archive: true, by_country: v });
const client = () => createClient(API_URL, SERVICE_KEY);

Deno.test("архив: живая встреча находится всеми функциями поиска (контроль фикстуры)", async () => {
  await withMeeting(async (db, id) => assertEquals(await foundBySearch(db, id), everywhere(true)));
});

Deno.test("архив: архивная встреча не находится НИ одной функцией поиска", async () => {
  await withMeeting(async (db, id) => {
    await db.queryArray`update entries set archived_at = now(), archived_by = ${OWNER} where id = ${id}`;
    assertEquals(await foundBySearch(db, id), everywhere(false));
  });
});

Deno.test("archiveEntry: запись остаётся строкой, задачи встречи — в архиве по обоим ключам", async () => {
  await withMeeting(async (db, id) => {
    const res = await archiveEntry(client(), { id, metadata: { meeting_id: SOURCE_MEETING } }, OWNER);
    assertEquals(res, { error: null, archivedTasks: 2 });

    const row = await db.queryObject<{ archived_by: string; archived: boolean }>`
      select archived_by::text, archived_at is not null as archived from entries where id = ${id}`;
    assertEquals(row.rows.length, 1, "запись стёрта физически");
    assertEquals(row.rows[0], { archived_by: String(OWNER), archived: true });

    const tasks = await db.queryObject<{ n: number; archived: number }>`
      select count(*)::int as n, count(*) filter (where archived_at is not null)::int as archived
      from tasks where group_id = ${WS}`;
    assertEquals(tasks.rows[0], { n: 2, archived: 2 }, "задачи встречи стёрты или остались живыми (#687)");
  });
});

Deno.test("архив: гард записи отдаёт 404, список воркспейса её не показывает", async () => {
  await withMeeting(async (_db, id) => {
    const sb = client();
    const before = await buildEntriesQuery(sb, "id", { groupId: WS, telegramId: OWNER });
    assert((before.data ?? []).some((r) => (r as unknown as { id: string }).id === id), "контроль: живая запись видна");

    await archiveEntry(sb, { id, metadata: null }, OWNER);
    await assertRejects(() => getEntrySecure(sb, id, { groupId: WS, telegramId: OWNER }));
    const after = await buildEntriesQuery(sb, "id", { groupId: WS, telegramId: OWNER });
    assertEquals(after.error, null);
    assertEquals((after.data ?? []).some((r) => (r as unknown as { id: string }).id === id), false);
  });
});
