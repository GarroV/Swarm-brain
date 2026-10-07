// Скрытый у себя черновик групповой встречи (issue #818) — на НАСТОЯЩЕЙ базе через PostgREST.
//
// Фильтр очереди — строка для `.or()` с вложенными `and(...)` и `not.cs`: юнит-тест проверяет
// только текст строки, а понимает ли его PostgREST, видно лишь живым запросом. Ошибка тут
// молчаливая в худшую сторону: неверный фильтр либо роняет очередь, либо прячет встречу у всех.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";
import { createClient } from "@supabase/supabase-js";
import { draftMeetingsOwnScopedFilter } from "./meeting-access.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ME = 900818;
const PEER = 900819;
const KEY = "hidden-818";

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

async function ownQueue(viewer: number): Promise<string[]> {
  const sb = createClient(API_URL, SERVICE_KEY);
  const { data, error } = await sb.from("meetings").select("identity_key")
    .like("identity_key", `${KEY}%`)
    .or(draftMeetingsOwnScopedFilter(viewer));
  if (error) throw new Error(`фильтр очереди не принят PostgREST: ${error.message}`);
  return (data ?? []).map((r) => r.identity_key as string).sort();
}

Deno.test("скрытая у себя встреча уходит только из своей очереди, у соседа остаётся (#818)", async () => {
  const db = await connect();
  const recorders = JSON.stringify([{ telegram_id: ME }]);
  try {
    await db.queryArray`delete from meetings where identity_key like ${KEY + "%"}`;
    // Записывал я, сосед — совладелец; первую я скрыл, вторую — нет.
    await db.queryArray`
      insert into meetings (status, identity_kind, identity_key, recorders, co_owners, hidden_for)
      values ('awaiting_review', 'manual', ${KEY + "-a"}, ${recorders}::jsonb, ${[PEER]}, ${[ME]}),
             ('awaiting_review', 'manual', ${KEY + "-b"}, ${recorders}::jsonb, ${[PEER]}, '{}')`;

    assertEquals(await ownQueue(ME), [`${KEY}-b`], "у скрывшего — только нескрытая");
    assertEquals(await ownQueue(PEER), [`${KEY}-a`, `${KEY}-b`], "у совладельца — обе");
  } finally {
    await db.queryArray`delete from meetings where identity_key like ${KEY + "%"}`;
    await db.end();
  }
});
