import type { OAuthConfig } from "./config.ts";
import { checkDb, type OAuthDb, rpc } from "./db.ts";
import { errorResponse, jsonResponse } from "./http.ts";
import { clientKind, CODE_PREFIX, jsonBody, OAuthError, randomSecret, sha256 } from "./rules.ts";

export interface OAuthAccount {
  telegramId: number;
  groupId: string;
  isDemo: boolean;
  renewableSession: boolean;
}

interface PendingRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  expires_at: string;
  consumed_at: string | null;
}

function validRequestId(id: unknown): id is string {
  return typeof id === "string" && /^smorq_[A-Za-z0-9_-]{43}$/.test(id);
}

async function consentDetails(db: OAuthDb, req: Request, account: OAuthAccount): Promise<Response> {
  const values = new URL(req.url).searchParams.getAll("request");
  if (values.length !== 1 || !validRequestId(values[0])) {
    throw new OAuthError("invalid_request", "Invalid authorization request");
  }
  const { data, error } = await db.from("mcp_oauth_requests").select("id,client_id,redirect_uri,expires_at,consumed_at")
    .eq("id", values[0]).maybeSingle();
  checkDb(error);
  const pending = data as PendingRequest | null;
  if (!pending || pending.consumed_at || Date.parse(pending.expires_at) <= Date.now()) {
    throw new OAuthError("invalid_request", "Authorization request has expired; reconnect from your AI client", 410);
  }
  const [client, workspace] = await Promise.all([
    db.from("mcp_oauth_clients").select("client_name").eq("client_id", pending.client_id).single(),
    db.from("workspaces").select("name").eq("id", account.groupId).single(),
  ]);
  checkDb(client.error);
  checkDb(workspace.error);
  return jsonResponse({
    requestId: pending.id,
    clientName: client.data!.client_name,
    redirectHost: new URL(pending.redirect_uri).host,
    workspaceName: workspace.data!.name,
    expiresAt: pending.expires_at,
  });
}

async function consent(db: OAuthDb, req: Request, account: OAuthAccount, config: OAuthConfig): Promise<Response> {
  const value = await jsonBody(req);
  if (!validRequestId(value.requestId) || typeof value.accept !== "boolean") {
    throw new OAuthError("invalid_request", "Expected requestId and accept");
  }
  const code = randomSecret(CODE_PREFIX);
  const result = await rpc<{ error?: string; redirect_uri: string; state: string | null; accepted: boolean }>(
    db,
    "mcp_oauth_approve",
    {
      p_request_id: value.requestId,
      p_telegram_id: account.telegramId,
      p_group_id: account.groupId,
      p_accept: value.accept,
      p_code_hash: await sha256(code),
    },
  );
  if (result.error) {
    throw new OAuthError(
      result.error,
      "Authorization request is invalid or expired",
      result.error === "access_denied" ? 403 : 410,
    );
  }
  const redirect = new URL(result.redirect_uri);
  if (result.accepted) redirect.searchParams.set("code", code);
  else redirect.searchParams.set("error", "access_denied");
  if (result.state !== null) redirect.searchParams.set("state", result.state);
  // RFC 9207: the discovery document advertises this for both success and refusal.
  redirect.searchParams.set("iss", config.issuer);
  return jsonResponse({ redirectUrl: redirect.toString() });
}

async function connections(db: OAuthDb, account: OAuthAccount, config: OAuthConfig): Promise<Response> {
  const { data, error } = await db.from("mcp_oauth_connections").select(
    "id,client_id,redirect_uri,created_at,last_seen_at,expires_at",
  )
    .eq("telegram_id", account.telegramId).eq("group_id", account.groupId).is("revoked_at", null).gt(
      "expires_at",
      new Date().toISOString(),
    ).order("created_at", { ascending: false });
  checkDb(error);
  const grants = (data ?? []) as {
    id: string;
    client_id: string;
    redirect_uri: string;
    created_at: string;
    last_seen_at: string | null;
    expires_at: string;
  }[];
  const ids = [...new Set(grants.map((grant) => grant.client_id))];
  const clients = ids.length
    ? await db.from("mcp_oauth_clients").select("client_id,client_name").in("client_id", ids)
    : { data: [], error: null };
  checkDb(clients.error);
  const names = new Map(
    (clients.data ?? []).map((
      client: { client_id: string; client_name: string },
    ) => [client.client_id, client.client_name]),
  );
  return jsonResponse({
    mcpUrl: config.resource,
    connections: grants.map((grant) => ({
      id: grant.id,
      clientName: names.get(grant.client_id) ?? "MCP client",
      clientKind: clientKind([grant.redirect_uri]),
      createdAt: grant.created_at,
      lastSeenAt: grant.last_seen_at,
      expiresAt: grant.expires_at,
    })),
  });
}

/** Called only after the regular API's login, second-step and maintenance gates. */
export async function handleOAuthAccountRoute(
  db: OAuthDb,
  req: Request,
  routePath: string,
  account: OAuthAccount,
  config: OAuthConfig,
): Promise<Response | null> {
  const relevant = routePath === "/mcp/oauth/authorize" || routePath === "/mcp/connections" ||
    routePath.startsWith("/mcp/connections/");
  if (!relevant) return null;
  try {
    if (account.isDemo || !account.renewableSession || !Number.isSafeInteger(account.telegramId) || !account.groupId) {
      throw new OAuthError("access_denied", "Sign in to your own Swarm account to manage AI connections", 403);
    }
    if (routePath === "/mcp/oauth/authorize" && req.method === "GET") return await consentDetails(db, req, account);
    if (routePath === "/mcp/oauth/authorize" && req.method === "POST") return await consent(db, req, account, config);
    if (routePath === "/mcp/connections" && req.method === "GET") return await connections(db, account, config);
    if (routePath.startsWith("/mcp/connections/") && req.method === "DELETE") {
      const id = routePath.slice("/mcp/connections/".length);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new OAuthError("invalid_request", "Invalid connection", 404);
      }
      const { data, error } = await db.from("mcp_oauth_connections").update({ revoked_at: new Date().toISOString() })
        .eq("id", id).eq("telegram_id", account.telegramId).eq("group_id", account.groupId).is("revoked_at", null)
        .select("id").maybeSingle();
      checkDb(error);
      if (!data) throw new OAuthError("not_found", "Connection not found", 404);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  } catch (error) {
    return errorResponse(error);
  }
}
