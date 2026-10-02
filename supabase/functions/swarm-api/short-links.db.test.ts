// Сокращатель ссылок на настоящей базе: переход считает клик, архивная ссылка не открывается,
// а функцию перехода нельзя дёрнуть анонимным ключом через /rest/v1/rpc. Последнее ломается
// молча (грант на PUBLIC наследуют anon/authenticated) — урок GHSA-vxrp-599j-46hv.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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

Deno.test("переход: адрес + клик; архивная и несуществующая — пусто", async () => {
  const db = await connect();
  try {
    await db.queryArray`delete from public.short_links where code in ('tLive1', 'tGone1')`;
    await db.queryArray`insert into public.short_links (code, url, owner_id) values
      ('tLive1', 'https://example.com/a.pdf', 1), ('tGone1', 'https://example.com/b.pdf', 1)`;
    await db.queryArray`update public.short_links set archived_at = now() where code = 'tGone1'`;

    const hit = await db.queryArray<[string | null]>`select public.short_link_hit('tLive1')`;
    assertEquals(hit.rows[0][0], "https://example.com/a.pdf");
    const clicks = await db.queryArray<[number]>`select clicks from public.short_links where code = 'tLive1'`;
    assertEquals(clicks.rows[0][0], 1);

    const gone = await db.queryArray<[string | null]>`select public.short_link_hit('tGone1')`;
    assertEquals(gone.rows[0][0], null);
    const missing = await db.queryArray<[string | null]>`select public.short_link_hit('nope00')`;
    assertEquals(missing.rows[0][0], null);
  } finally {
    await db.queryArray`delete from public.short_links where code in ('tLive1', 'tGone1')`;
    await db.end();
  }
});

Deno.test("anon/authenticated не вызывают переход и не читают таблицу", async () => {
  const db = await connect();
  try {
    const r = await db.queryArray<[boolean, boolean, boolean, boolean]>`
      select has_function_privilege('anon', 'public.short_link_hit(text)', 'execute'),
             has_function_privilege('authenticated', 'public.short_link_hit(text)', 'execute'),
             has_table_privilege('anon', 'public.short_links', 'select'),
             has_function_privilege('service_role', 'public.short_link_hit(text)', 'execute')`;
    assertEquals(r.rows[0], [false, false, false, true]);
  } finally {
    await db.end();
  }
});

Deno.test("название и комментарий: пустые и слишком длинные отбивает сама база", async () => {
  const db = await connect();
  const rejects = async (title: string | null, note: string | null) => {
    try {
      await db.queryArray`insert into public.short_links (code, url, owner_id, title, note)
        values ('tMeta9', 'https://example.com/c.pdf', 1, ${title}, ${note})`;
      return false;
    } catch {
      return true;
    }
  };
  try {
    await db.queryArray`delete from public.short_links where code = 'tMeta9'`;
    assertEquals(await rejects("", null), true);
    assertEquals(await rejects("я".repeat(121), null), true);
    assertEquals(await rejects("ok", ""), true);
    assertEquals(await rejects("ok", "я".repeat(501)), true);
    assertEquals(await rejects("я".repeat(120), "я".repeat(500)), false);
  } finally {
    await db.queryArray`delete from public.short_links where code = 'tMeta9'`;
    await db.end();
  }
});
