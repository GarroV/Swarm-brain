// Доступ MCP (#1083): выпуск токена пишет срок 30 дней, триггер БД гасит токен при смене
// воркспейса или роли, журнал изменяющих вызовов — только дописывается и закрыт от anon.
import { assertEquals, assertNotEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { Client } from "postgres";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) {
    throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
  }
}
const { mintMcpToken, MCP_TOKEN_TTL_DAYS } = await import("../_shared/mcp-token.ts");
const { recordToolCall } = await import("./journal.ts");
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const USER = 990_301;
const WS_A = "qa-mcp-hardening-a";
const WS_B = "qa-mcp-hardening-b";
const DAY_MS = 86_400_000;

async function reset() {
  await sb.from("allowed_users").delete().eq("telegram_id", USER);
  for (const id of [WS_A, WS_B]) {
    const ws = await sb.from("workspaces").upsert({ id, name: `QA ${id}` });
    if (ws.error) throw ws.error;
  }
  const { error } = await sb.from("allowed_users").insert({ telegram_id: USER, group_id: WS_A, added_by: USER });
  if (error) throw error;
}

async function tokenRow() {
  const { data, error } = await sb.from("allowed_users")
    .select("claude_mcp_token_hash, claude_mcp_token_expires_at").eq("telegram_id", USER).single();
  if (error) throw error;
  return data as { claude_mcp_token_hash: string | null; claude_mcp_token_expires_at: string | null };
}

Deno.test("выпуск токена пишет срок 30 дней", async () => {
  await reset();
  const before = Date.now();
  assertNotEquals(await mintMcpToken(sb, USER, { via: "web" }), null);
  const row = await tokenRow();
  const expires = Date.parse(row.claude_mcp_token_expires_at!);
  assertEquals(MCP_TOKEN_TTL_DAYS, 30);
  assertEquals(Math.abs(expires - (before + 30 * DAY_MS)) < 60_000, true);
});

Deno.test("смена воркспейса гасит токен триггером", async () => {
  await reset();
  await mintMcpToken(sb, USER, { via: "web" });
  const { error } = await sb.from("allowed_users").update({ group_id: WS_B }).eq("telegram_id", USER);
  if (error) throw error;
  assertEquals(await tokenRow(), { claude_mcp_token_hash: null, claude_mcp_token_expires_at: null });
});

Deno.test("смена роли (is_admin) гасит токен триггером", async () => {
  await reset();
  await mintMcpToken(sb, USER, { via: "web" });
  const { error } = await sb.from("allowed_users").update({ is_admin: true }).eq("telegram_id", USER);
  if (error) throw error;
  assertEquals((await tokenRow()).claude_mcp_token_hash, null);
});

Deno.test("правка постороннего поля токен не трогает, а перевыпуск вместе со сменой группы — тоже", async () => {
  await reset();
  await mintMcpToken(sb, USER, { via: "web" });
  const issued = (await tokenRow()).claude_mcp_token_hash;
  await sb.from("allowed_users").update({ username: "qa" }).eq("telegram_id", USER);
  assertEquals((await tokenRow()).claude_mcp_token_hash, issued);
  // тот же UPDATE меняет и группу, и хэш (выпуск нового токена) — новый токен выживает
  await sb.from("allowed_users").update({ group_id: WS_B, claude_mcp_token_hash: "newhash" }).eq("telegram_id", USER);
  assertEquals((await tokenRow()).claude_mcp_token_hash, "newhash");
});

Deno.test("журнал: строка без аргументов, anon не читает и не пишет, строки не правятся и не удаляются", async () => {
  await sb.from("mcp_tool_journal").delete().eq("telegram_id", USER).then(() => {}, () => {});
  assertEquals(
    await recordToolCall(sb as never, {
      telegramId: USER,
      tool: "add_task",
      outcome: "ok",
      tokenHash: "f".repeat(58) + "abcdef",
    }),
    true,
  );
  const { data, error } = await sb.from("mcp_tool_journal").select("*").eq("telegram_id", USER);
  if (error) throw error;
  assertEquals(Object.keys(data![0]).sort(), ["id", "outcome", "telegram_id", "token_hint", "tool", "ts"]);
  assertEquals(data![0].token_hint, "abcdef");

  const upd = await sb.from("mcp_tool_journal").update({ outcome: "error" }).eq("telegram_id", USER);
  assertNotEquals(upd.error, null);
  const del = await sb.from("mcp_tool_journal").delete().eq("telegram_id", USER);
  assertNotEquals(del.error, null);
});

Deno.test("журнал и триггерные функции закрыты от anon/authenticated: RLS включён, прав нет", async () => {
  const db = new Client(Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await db.connect();
  try {
    const { rows } = await db.queryObject<{ rls: boolean; policies: number; anon_priv: boolean; auth_priv: boolean }>(`
      select c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = 'mcp_tool_journal') as policies,
             has_table_privilege('anon', 'public.mcp_tool_journal', 'SELECT,INSERT,UPDATE,DELETE') as anon_priv,
             has_table_privilege('authenticated', 'public.mcp_tool_journal', 'SELECT,INSERT,UPDATE,DELETE') as auth_priv
        from pg_class c where c.oid = 'public.mcp_tool_journal'::regclass`);
    assertEquals(rows[0], { rls: true, policies: 0, anon_priv: false, auth_priv: false });
    for (const fn of ["revoke_mcp_token_on_access_change", "mcp_tool_journal_append_only"]) {
      const r = await db.queryObject<{ pub: boolean; anon: boolean; auth: boolean }>(`
        select has_function_privilege('anon', 'public.${fn}()', 'EXECUTE') as anon,
               has_function_privilege('authenticated', 'public.${fn}()', 'EXECUTE') as auth,
               false as pub`);
      assertEquals([r.rows[0].anon, r.rows[0].auth], [false, false], fn);
    }
  } finally {
    await db.end();
  }
});
