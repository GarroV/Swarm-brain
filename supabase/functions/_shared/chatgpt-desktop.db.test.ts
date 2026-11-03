import { assertEquals } from "@std/assert";
import { Client } from "postgres";

Deno.test("desktop credential rotation is independent; role/workspace changes revoke it atomically", async () => {
  const db = new Client(Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await db.connect();
  const ws = "chatgpt-desktop-test-" + crypto.randomUUID();
  const other = ws + "-other";
  const id = -Math.floor(Date.now() * 100 + Math.random() * 100);
  const claude = crypto.randomUUID().replaceAll("-", "");
  try {
    await db.queryArray`begin`;
    await db.queryArray`insert into workspaces(id,name) values(${ws},${ws}),(${other},${other})`;
    await db
      .queryArray`insert into allowed_users(telegram_id,username,added_by,group_id,is_admin,claude_mcp_token_hash,claude_mcp_token_expires_at) values(${id},'ChatGPT test',0,${ws},false,${claude},now()+interval '1 day')`;
    const issue = () =>
      db.queryArray`update allowed_users set chatgpt_mcp_token_hash=${crypto.randomUUID()},chatgpt_mcp_token_expires_at=now()+interval '30 days',chatgpt_mcp_last_seen_at=now() where telegram_id=${id}`;
    const status = async () =>
      (await db.queryObject<
        { claude: string | null; gpt: string | null; expiry: unknown; seen: unknown }
      >`select claude_mcp_token_hash as claude,chatgpt_mcp_token_hash as gpt,chatgpt_mcp_token_expires_at as expiry,chatgpt_mcp_last_seen_at as seen from allowed_users where telegram_id=${id}`)
        .rows[0];
    await issue();
    const first = await status();
    await issue();
    const second = await status();
    assertEquals(first.gpt === second.gpt, false);
    assertEquals(second.claude, claude);
    await db
      .queryArray`update allowed_users set chatgpt_mcp_token_hash=null,chatgpt_mcp_token_expires_at=null where telegram_id=${id}`;
    assertEquals((await status()).claude, claude);
    await issue();
    await db.queryArray`update allowed_users set is_admin=true where telegram_id=${id}`;
    let row = await status();
    assertEquals([row.gpt, row.expiry, row.seen], [null, null, null]);
    await issue();
    await db.queryArray`update allowed_users set group_id=${other} where telegram_id=${id}`;
    row = await status();
    assertEquals([row.gpt, row.expiry, row.seen], [null, null, null]);
    await issue();
    await db.queryArray`delete from allowed_users where telegram_id=${id}`;
    assertEquals(await status(), undefined);
  } finally {
    await db.queryArray`rollback`;
    await db.end();
  }
});
