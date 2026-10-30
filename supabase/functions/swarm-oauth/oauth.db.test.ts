// Integration proof for OAuth lifecycle against an isolated real Supabase/PostgREST database.
// Use scripts/mcp-chatgpt-stand.ps1 -Action TestDb -TestFile <this file> on MUSPELHEIM.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handleOAuthAccountRoute,
  handleOAuthPublicRequest,
  resolveOAuthAccessToken,
} from "../_shared/mcp-oauth/index.ts";
import type { OAuthAccount, OAuthConfig } from "../_shared/mcp-oauth/index.ts";
import { pkceChallenge, randomSecret, sha256 } from "../_shared/mcp-oauth/rules.ts";

const api = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!api || !key) {
  throw new Error(
    "OAuth database tests require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from an isolated test stand",
  );
}
const db = createClient(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const config: OAuthConfig = {
  issuer: "https://oauth.example",
  webBaseUrl: "https://oauth.example",
  resource: "https://api.example/functions/v1/swarm-mcp",
};
const callback = "https://chatgpt.com/connector/oauth/qa";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
type Value = Record<string, unknown>;

async function read(response: Response, status = 200): Promise<Value> {
  const value = await response.json();
  assertEquals(response.status, status, JSON.stringify(value));
  return value;
}

interface Fixture {
  account: OAuthAccount;
  clientId: string;
  workspaceId: string;
  requestId?: string;
  code?: string;
  connectionId?: string;
}

async function fixture(): Promise<Fixture> {
  const user = 990_730_000 + crypto.getRandomValues(new Uint32Array(1))[0] % 100_000;
  const workspaceId = `qa-oauth-${crypto.randomUUID()}`;
  const workspace = await db.from("workspaces").insert({ id: workspaceId, name: "OAuth QA workspace" });
  assertEquals(workspace.error, null);
  const inserted = await db.from("allowed_users").insert({ telegram_id: user, group_id: workspaceId, added_by: user });
  assertEquals(inserted.error, null);
  const registered = await read(
    await handleOAuthPublicRequest(
      db,
      new Request(`${config.issuer}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": crypto.randomUUID() },
        body: JSON.stringify({
          client_name: "QA ChatGPT",
          redirect_uris: [callback],
          token_endpoint_auth_method: "none",
        }),
      }),
      config,
    ),
    201,
  );
  return {
    account: { telegramId: user, groupId: workspaceId, isDemo: false, renewableSession: true },
    clientId: registered.client_id as string,
    workspaceId,
  };
}

async function clean(f: Fixture): Promise<void> {
  assertEquals((await db.from("mcp_oauth_clients").delete().eq("client_id", f.clientId)).error, null);
  assertEquals((await db.from("allowed_users").delete().eq("telegram_id", f.account.telegramId)).error, null);
  assertEquals((await db.from("workspaces").delete().eq("id", f.workspaceId)).error, null);
}

async function authorize(f: Fixture, extra: Record<string, string> = {}): Promise<Response> {
  const params = new URLSearchParams({
    client_id: f.clientId,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    resource: config.resource,
    scope: "mcp offline_access",
    state: "qa-state",
    ...extra,
  });
  const response = await handleOAuthPublicRequest(
    db,
    new Request(`${config.issuer}/oauth/authorize?${params}`),
    config,
  );
  if (response.status === 302) f.requestId = new URL(response.headers.get("Location")!).searchParams.get("mcp_oauth")!;
  return response;
}

async function account(f: Fixture, method: string, path: string, body?: Value, who = f.account): Promise<Response> {
  const response = await handleOAuthAccountRoute(
    db,
    new Request(`${config.issuer}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    path.split("?")[0],
    who,
    config,
  );
  assert(response);
  return response;
}

async function approve(f: Fixture): Promise<void> {
  assertEquals((await authorize(f)).status, 302);
  const details = await read(await account(f, "GET", `/mcp/oauth/authorize?request=${f.requestId}`));
  assertEquals(details.clientName, "QA ChatGPT");
  assertEquals(details.redirectHost, "chatgpt.com");
  const approval = await read(
    await account(f, "POST", "/mcp/oauth/authorize", { requestId: f.requestId, accept: true }),
  );
  const target = new URL(approval.redirectUrl as string);
  assertEquals(target.origin, "https://chatgpt.com");
  assertEquals(target.searchParams.get("iss"), config.issuer);
  assertEquals(target.searchParams.get("state"), "qa-state");
  f.code = target.searchParams.get("code")!;
  const list = await read(await account(f, "GET", "/mcp/connections"));
  const grants = list.connections as Value[];
  assertEquals(grants.length, 1);
  assertEquals(grants[0].clientKind, "chatgpt");
  assertEquals(grants[0].lastSeenAt, null);
  f.connectionId = grants[0].id as string;
}

async function exchange(f: Fixture, params: Record<string, string> = {}): Promise<Response> {
  return await handleOAuthPublicRequest(
    db,
    new Request(`${config.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: f.code!,
        client_id: f.clientId,
        redirect_uri: callback,
        code_verifier: verifier,
        resource: config.resource,
        ...params,
      }),
    }),
    config,
  );
}

async function refresh(f: Fixture, refreshToken: string): Promise<Response> {
  return await handleOAuthPublicRequest(
    db,
    new Request(`${config.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: f.clientId,
        resource: config.resource,
      }),
    }),
    config,
  );
}

Deno.test("OAuth: full DCR → consent → PKCE → MCP identity → refresh → personal revoke", async () => {
  const f = await fixture();
  try {
    await approve(f);
    const pair = await read(await exchange(f));
    assertEquals(pair.token_type, "Bearer");
    assert((pair.expires_in as number) > 3500);
    const identity = await resolveOAuthAccessToken(db, pair.access_token as string, config.resource);
    assertEquals(identity?.telegramId, f.account.telegramId);
    assertEquals(identity?.groupId, f.workspaceId);
    assertEquals(await resolveOAuthAccessToken(db, pair.access_token as string, "https://other.example/mcp"), null);
    const renewed = await read(await refresh(f, pair.refresh_token as string));
    assertNotEquals(pair.refresh_token, renewed.refresh_token);
    assert((await resolveOAuthAccessToken(db, renewed.access_token as string, config.resource))?.telegramId);
    assertEquals((await read(await account(f, "DELETE", `/mcp/connections/${f.connectionId}`))).ok, true);
    assertEquals(await resolveOAuthAccessToken(db, renewed.access_token as string, config.resource), null);
    assertEquals((await read(await refresh(f, renewed.refresh_token as string), 400)).error, "invalid_grant");
    const hashes = await db.from("mcp_oauth_tokens").select("token_hash").eq("connection_id", f.connectionId);
    assertEquals(hashes.error, null);
    assert((hashes.data ?? []).every((row) => /^[0-9a-f]{64}$/.test(row.token_hash)));
  } finally {
    await clean(f);
  }
});

Deno.test("OAuth: wrong PKCE/client/callback/resource cannot consume a code; approved request is single-use", async () => {
  const f = await fixture();
  try {
    assertEquals((await authorize(f, { redirect_uri: "https://attacker.example/callback" })).status, 400);
    for (
      const [extra, expected] of [[{ code_challenge_method: "plain" }, "invalid_request"], [{
        resource: "https://other.example/mcp",
      }, "invalid_target"]] as const
    ) {
      const response = await authorize(f, extra);
      assertEquals(response.status, 302);
      const target = new URL(response.headers.get("Location")!);
      assertEquals(target.origin, "https://chatgpt.com");
      assertEquals(target.searchParams.get("error"), expected);
      assertEquals(target.searchParams.get("state"), "qa-state");
      assertEquals(target.searchParams.get("iss"), config.issuer);
    }
    await approve(f);
    assertEquals((await read(await exchange(f, { code_verifier: "x".repeat(43) }), 400)).error, "invalid_grant");
    assertEquals((await read(await exchange(f, { client_id: randomSecret("foreign_") }), 400)).error, "invalid_grant");
    assertEquals(
      (await read(await exchange(f, { redirect_uri: "https://attacker.example/callback" }), 400)).error,
      "invalid_grant",
    );
    assertEquals(
      (await read(await exchange(f, { resource: "https://other.example/mcp" }), 400)).error,
      "invalid_target",
    );
    const pair = await read(await exchange(f));
    assert(await resolveOAuthAccessToken(db, pair.access_token as string, config.resource));
    assertEquals(
      (await account(f, "POST", "/mcp/oauth/authorize", { requestId: f.requestId, accept: true })).status,
      410,
    );
    assertEquals((await read(await exchange(f), 400)).error, "invalid_grant");
    assertEquals(await resolveOAuthAccessToken(db, pair.access_token as string, config.resource), null);
  } finally {
    await clean(f);
  }
});

Deno.test("OAuth: refresh replay revokes successors; simultaneous refresh cannot create two surviving grants", async () => {
  const f = await fixture();
  try {
    await approve(f);
    const pair = await read(await exchange(f));
    const races = await Promise.all([
      refresh(f, pair.refresh_token as string),
      refresh(f, pair.refresh_token as string),
    ]);
    assertEquals(races.map((res) => res.status).sort(), [200, 400]);
    const winner = await read(races.find((res) => res.status === 200)!);
    await races.find((res) => res.status === 400)!.body?.cancel();
    assertEquals(await resolveOAuthAccessToken(db, winner.access_token as string, config.resource), null);
  } finally {
    await clean(f);
  }
});

Deno.test("OAuth: rejection echoes state and issuer, grants nothing; demo and short sessions cannot approve", async () => {
  const f = await fixture();
  try {
    assertEquals((await authorize(f)).status, 302);
    const payload = { requestId: f.requestId, accept: true };
    assertEquals(
      (await account(f, "POST", "/mcp/oauth/authorize", payload, { ...f.account, isDemo: true })).status,
      403,
    );
    assertEquals(
      (await account(f, "POST", "/mcp/oauth/authorize", payload, { ...f.account, renewableSession: false })).status,
      403,
    );
    const declined = await read(await account(f, "POST", "/mcp/oauth/authorize", { ...payload, accept: false }));
    const target = new URL(declined.redirectUrl as string);
    assertEquals(target.searchParams.get("error"), "access_denied");
    assertEquals(target.searchParams.get("state"), "qa-state");
    assertEquals(target.searchParams.get("iss"), config.issuer);
    assertEquals(target.searchParams.has("code"), false);
    assertEquals((await read(await account(f, "GET", "/mcp/connections"))).connections, []);
  } finally {
    await clean(f);
  }
});

Deno.test("OAuth: another employee cannot list or revoke grants; role change and deletion revoke immediately", async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    await approve(f);
    const pair = await read(await exchange(f));
    assertEquals((await read(await account(other, "GET", "/mcp/connections"))).connections, []);
    assertEquals((await account(other, "DELETE", `/mcp/connections/${f.connectionId}`)).status, 404);
    assert(await resolveOAuthAccessToken(db, pair.access_token as string, config.resource));
    assertEquals(
      (await db.from("allowed_users").update({ is_admin: true }).eq("telegram_id", f.account.telegramId)).error,
      null,
    );
    assertEquals(await resolveOAuthAccessToken(db, pair.access_token as string, config.resource), null);
    assertEquals((await refresh(f, pair.refresh_token as string)).status, 400);
    await approve(f);
    const next = await read(await exchange(f));
    assertEquals((await db.from("allowed_users").delete().eq("telegram_id", f.account.telegramId)).error, null);
    assertEquals(await resolveOAuthAccessToken(db, next.access_token as string, config.resource), null);
  } finally {
    await clean(f);
    await clean(other);
  }
});

Deno.test("OAuth: workspace transfer, expired grants and expired requests fail closed", async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    await approve(f);
    const pair = await read(await exchange(f));
    assertEquals(
      (await db.from("allowed_users").update({ group_id: other.workspaceId }).eq("telegram_id", f.account.telegramId))
        .error,
      null,
    );
    assertEquals(await resolveOAuthAccessToken(db, pair.access_token as string, config.resource), null);
    assertEquals((await refresh(f, pair.refresh_token as string)).status, 400);
    assertEquals(
      (await db.from("allowed_users").update({ group_id: f.workspaceId }).eq("telegram_id", f.account.telegramId))
        .error,
      null,
    );
    assertEquals((await authorize(f)).status, 302);
    assertEquals(
      (await db.from("mcp_oauth_requests").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("id", f.requestId)).error,
      null,
    );
    assertEquals(
      (await account(f, "POST", "/mcp/oauth/authorize", { requestId: f.requestId, accept: true })).status,
      410,
    );
    await approve(f);
    const fresh = await read(await exchange(f));
    assertEquals(
      (await db.from("mcp_oauth_connections").update({ expires_at: "2000-01-01T00:00:00Z" }).eq("id", f.connectionId))
        .error,
      null,
    );
    assertEquals(await resolveOAuthAccessToken(db, fresh.access_token as string, config.resource), null);
    assertEquals((await refresh(f, fresh.refresh_token as string)).status, 400);
  } finally {
    await clean(f);
    await clean(other);
  }
});

Deno.test("OAuth: database rate buckets are atomic and consumed refresh/code values are hashes", async () => {
  const bucket = `qa:${crypto.randomUUID()}`;
  try {
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        () => db.rpc("mcp_oauth_take_rate", { p_bucket: bucket, p_limit: 3, p_window_seconds: 60 }),
      ),
    );
    assert(results.every((result) => result.error === null));
    assertEquals(results.filter((result) => result.data === true).length, 3);
    assertEquals(
      (await db.rpc("mcp_oauth_resolve", { p_token_hash: await sha256("not-a-token"), p_resource: config.resource }))
        .data,
      null,
    );
  } finally {
    await db.from("mcp_oauth_rate_buckets").delete().eq("bucket", bucket);
  }
});
