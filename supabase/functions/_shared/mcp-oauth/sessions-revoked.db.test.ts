import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const RESOURCE = "https://api.example/functions/v1/swarm-mcp";

// «Выйти везде» отключает и подключения нейросетей: resolve не принимает подключение,
// созданное раньше отметки allowed_users.sessions_revoked_at; новое после неё — принимает.
Deno.test("mcp_oauth_resolve refuses connections created before sessions_revoked_at", async () => {
  const db = new Client(Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await db.connect();
  const ws = "oauth-revoke-test-" + crypto.randomUUID();
  const id = -Math.floor(Date.now() * 100 + Math.random() * 100);
  const hex = () => (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
  const clientId = "test-client-" + crypto.randomUUID();
  const oldToken = hex();
  const newToken = hex();
  try {
    await db.queryArray`begin`;
    await db.queryArray`insert into workspaces(id,name) values(${ws},${ws})`;
    await db
      .queryArray`insert into allowed_users(telegram_id,username,added_by,group_id,is_admin) values(${id},'OAuth revoke test',0,${ws},false)`;
    await db
      .queryArray`insert into mcp_oauth_clients(client_id,client_name,redirect_uris) values(${clientId},'Test',array['https://claude.ai/cb'])`;
    const connect = async (token: string, createdAt: string) => {
      const row = (await db.queryObject<{ id: string }>`
        insert into mcp_oauth_connections(telegram_id,group_id,client_id,redirect_uri,resource,scope,created_at)
        values(${id},${ws},${clientId},'https://claude.ai/cb',${RESOURCE},'mcp',${createdAt}::timestamptz) returning id`)
        .rows[0];
      await db.queryArray`insert into mcp_oauth_tokens(token_hash,connection_id,kind,expires_at)
        values(${token},${row.id},'access',now()+interval '1 hour')`;
    };
    const resolve = async (token: string) =>
      (await db.queryObject<{ r: unknown }>`select public.mcp_oauth_resolve(${token},${RESOURCE}) as r`).rows[0].r;

    await connect(oldToken, "2026-01-01T00:00:00Z");
    assertEquals((await resolve(oldToken) as { telegramId: number }).telegramId, id);

    await db.queryArray`update allowed_users set sessions_revoked_at = now() where telegram_id=${id}`;
    assertEquals(await resolve(oldToken), null);

    await connect(newToken, new Date(Date.now() + 60_000).toISOString());
    assertEquals((await resolve(newToken) as { telegramId: number }).telegramId, id);

    // Права функции не ушли на PUBLIC/anon.
    const grants = (await db.queryObject<{ anon: boolean; svc: boolean }>`
      select has_function_privilege('anon','public.mcp_oauth_resolve(text,text)','execute') as anon,
             has_function_privilege('service_role','public.mcp_oauth_resolve(text,text)','execute') as svc`).rows[0];
    assertEquals([grants.anon, grants.svc], [false, true]);
  } finally {
    await db.queryArray`rollback`;
    await db.end();
  }
});
