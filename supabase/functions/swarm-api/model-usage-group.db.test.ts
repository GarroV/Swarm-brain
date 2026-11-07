// Расход пространства: строка с встречей, но без group_id, получает пространство встречи
// (триггер model_usage_fill_group). Без него «Расход» в карточке пространства показывал $0.
//
// Пропускаться не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const WS = "usage-grp-ws";
const OTHER = "usage-grp-other";
const TAG = "usage-grp";

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
  await db.queryArray`delete from model_usage where purpose like ${TAG + "%"}`;
  await db.queryArray`delete from meetings where identity_key like ${TAG + "%"}`;
  await db.queryArray`delete from workspaces where id in (${WS}, ${OTHER})`;
}

Deno.test("расход: строка со встречей без group_id получает пространство встречи", async () => {
  const db = await connect();
  try {
    await cleanup(db);
    await db.queryArray`insert into workspaces (id, name) values (${WS}, ${TAG}), (${OTHER}, ${TAG})`;
    const m = await db.queryObject<{ id: string }>`
      insert into meetings (status, identity_kind, identity_key, title, group_id)
      values ('in_base', 'manual', ${TAG + crypto.randomUUID()}, ${TAG}, ${WS}) returning id`;
    const id = m.rows[0].id;
    await db.queryArray`
      insert into model_usage (kind, purpose, meeting_id) values ('chat', ${TAG + ":no-group"}, ${id})`;
    await db.queryArray`
      insert into model_usage (kind, purpose, meeting_id, group_id) values ('chat', ${
      TAG + ":explicit"
    }, ${id}, ${OTHER})`;
    await db.queryArray`insert into model_usage (kind, purpose) values ('chat', ${TAG + ":no-meeting"})`;
    const rows = await db.queryObject<{ purpose: string; group_id: string | null }>`
      select purpose, group_id from model_usage where purpose like ${TAG + "%"} order by purpose`;
    assertEquals(rows.rows.map((r) => [r.purpose, r.group_id]), [
      [TAG + ":explicit", OTHER], // заданное кодом не перетирается
      [TAG + ":no-group", WS], // пусто + встреча → пространство встречи
      [TAG + ":no-meeting", null], // без встречи восстановить нечем
    ]);
  } finally {
    await cleanup(db);
    await db.end();
  }
});
