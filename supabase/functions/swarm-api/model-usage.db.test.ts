// Названия встреч в «Расходе модели» — на НАСТОЯЩЕЙ базе (решение владельца 2026-08-07, #15):
// личная встреча видна только владельцу и тем, с кем разделена, админского обхода нет. Суммы
// расхода админ видит по объёму, название чужой личной встречи — нет.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";
import { createClient } from "@supabase/supabase-js";
import { handleModelUsageRoutes, MODEL_USAGE_PATH, type UsageScope } from "./model-usage.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const OWNER = 900233;
const ADMIN = 900234; // админ того же пространства, но не владелец встречи
const SHARED = 900235;
const TAG = "usage-233";

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

async function meetingWithEntry(db: Client, title: string, isPrivate: boolean, shared: number[]): Promise<string> {
  const e = await db.queryObject<{ id: string }>`
    insert into entries (content, entry_type, source, added_by, is_private, owner_id, shared_with)
    values (${TAG}, 'meeting', 'test', 'test', ${isPrivate}, ${OWNER}, ${shared}) returning id`;
  const m = await db.queryObject<{ id: string }>`
    insert into meetings (status, identity_kind, identity_key, title, entry_id)
    values ('in_base', 'manual', ${TAG + crypto.randomUUID()}, ${title}, ${e.rows[0].id}) returning id`;
  await db.queryArray`
    insert into model_usage (kind, model, purpose, meeting_id, group_id, cost_usd)
    values ('chat', 'gpt-5.6-terra', 'meeting:tezisy', ${m.rows[0].id}, ${TAG}, 1.5)`;
  return m.rows[0].id;
}

async function cleanup(db: Client) {
  await db.queryArray`delete from model_usage where group_id = ${TAG}`;
  await db.queryArray`delete from meetings where identity_key like ${TAG + "%"}`;
  await db.queryArray`delete from entries where content = ${TAG}`;
  await db.queryArray`delete from allowed_users where telegram_id = ${OWNER}`;
}

async function usageAs(scope: UsageScope) {
  const sb = createClient(API_URL, SERVICE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const res = await handleModelUsageRoutes(
    new Request(`https://x${MODEL_USAGE_PATH}?from=${today}&to=${today}&workspace=${TAG}`),
    MODEL_USAGE_PATH,
    // deno-lint-ignore no-explicit-any
    sb as any,
    scope,
    "*",
  );
  return await res!.json() as { total_usd: number; meeting_titles: Record<string, string | null> };
}

Deno.test("расход: название личной встречи не уходит чужому админу и мастеру; сумма остаётся (#233)", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db
      .queryArray`insert into allowed_users (telegram_id, username, added_by) values (${OWNER}, ${TAG}, ${OWNER})`;
    const priv = await meetingWithEntry(db, "Личная: увольнение", true, [SHARED]);
    const open = await meetingWithEntry(db, "Общая встреча", false, []);

    for (
      const scope of [
        { isMaster: false, isAdmin: true, groupId: TAG, telegramId: ADMIN },
        { isMaster: true, isAdmin: true, groupId: "other", telegramId: ADMIN },
      ] satisfies UsageScope[]
    ) {
      const body = await usageAs(scope);
      assertEquals(body.meeting_titles[priv], null, "название личной встречи скрыто от неучастника");
      assertEquals(body.meeting_titles[open], "Общая встреча", "общая видна всем");
      assertEquals(body.total_usd, 3, "строки расхода остаются в сумме");
    }

    assertEquals(
      (await usageAs({ isMaster: false, isAdmin: true, groupId: TAG, telegramId: OWNER }))
        .meeting_titles[priv],
      "Личная: увольнение",
      "владелец видит",
    );
    assertEquals(
      (await usageAs({ isMaster: false, isAdmin: true, groupId: TAG, telegramId: SHARED }))
        .meeting_titles[priv],
      "Личная: увольнение",
      "тот, с кем разделена, видит",
    );
  } finally {
    await cleanup(db);
    await db.end();
  }
});
