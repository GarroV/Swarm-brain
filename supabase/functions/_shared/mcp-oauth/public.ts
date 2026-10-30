import { authorizationMetadata, type OAuthConfig, protectedResourceMetadata } from "./config.ts";
import { checkDb, type OAuthDb, rpc, takeRate } from "./db.ts";
import { errorResponse, jsonResponse, PUBLIC_HEADERS } from "./http.ts";
import {
  ACCESS_PREFIX,
  boundedBody,
  CODE_PREFIX,
  jsonBody,
  normalizeScope,
  OAuthError,
  pkceChallenge,
  randomSecret,
  REFRESH_PREFIX,
  requireParam,
  sha256,
  validateRegistration,
} from "./rules.ts";

interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

function pathOf(req: Request): string {
  return new URL(req.url).pathname.replace(/^\/functions\/v1\/swarm-oauth/, "").replace(/^\/swarm-oauth/, "");
}

function optionalParam(params: URLSearchParams, key: string, max: number): string | null {
  if (!params.has(key)) return null;
  return requireParam(params, key, max);
}

async function register(db: OAuthDb, req: Request): Promise<Response> {
  await takeRate(db, req, "register");
  const metadata = validateRegistration(await jsonBody(req));
  const clientId = randomSecret("smcp_client_");
  const { error } = await db.from("mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: metadata.clientName,
    redirect_uris: metadata.redirectUris,
  });
  checkDb(error);
  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: metadata.clientName,
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
    true,
  );
}

async function authorize(db: OAuthDb, req: Request, config: OAuthConfig): Promise<Response> {
  await takeRate(db, req, "authorize");
  const url = new URL(req.url);
  if (url.search.length > 8192) throw new OAuthError("invalid_request", "Authorization request is too large");
  const params = url.searchParams;
  const clientId = requireParam(params, "client_id", 200);
  const redirectUri = requireParam(params, "redirect_uri");
  const { data, error } = await db.from("mcp_oauth_clients").select("client_id,client_name,redirect_uris").eq(
    "client_id",
    clientId,
  ).maybeSingle();
  checkDb(error);
  const client = data as RegisteredClient | null;
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    throw new OAuthError("invalid_request", "Unknown client or callback URL");
  }
  // RFC 6749 §4.1.2.1: once the registered callback is trusted, finish failed
  // authorization in the client too. Before this point errors must stay local.
  try {
    if (requireParam(params, "response_type", 20) !== "code") {
      throw new OAuthError("unsupported_response_type", "Only authorization code is supported");
    }
    const challenge = requireParam(params, "code_challenge", 128);
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || requireParam(params, "code_challenge_method", 20) !== "S256") {
      throw new OAuthError("invalid_request", "PKCE S256 is required");
    }
    const resource = requireParam(params, "resource");
    if (resource !== config.resource) throw new OAuthError("invalid_target", "Wrong MCP resource");
    const scope = normalizeScope(optionalParam(params, "scope", 100) ?? undefined);
    const state = optionalParam(params, "state", 1024);
    const requestId = randomSecret("smorq_");
    const inserted = await db.from("mcp_oauth_requests").insert({
      id: requestId,
      client_id: clientId,
      redirect_uri: redirectUri,
      challenge,
      resource,
      scope,
      state,
    });
    checkDb(inserted.error);
    const target = new URL(`${config.webBaseUrl}/`);
    target.searchParams.set("mcp_oauth", requestId);
    return new Response(null, {
      status: 302,
      headers: { ...PUBLIC_HEADERS, Location: target.toString(), "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    if (!(error instanceof OAuthError)) console.error("MCP OAuth authorization failed");
    const failure = error instanceof OAuthError
      ? error
      : new OAuthError("server_error", "Authorization service unavailable");
    const target = new URL(redirectUri);
    target.searchParams.delete("code");
    target.searchParams.delete("state");
    target.searchParams.set("error", failure.code);
    target.searchParams.set("error_description", failure.message);
    target.searchParams.set("iss", config.issuer);
    const states = params.getAll("state");
    if (states.length === 1 && states[0].length <= 1024) target.searchParams.set("state", states[0]);
    return new Response(null, {
      status: 302,
      headers: { ...PUBLIC_HEADERS, Location: target.toString(), "Referrer-Policy": "no-referrer" },
    });
  }
}

async function form(req: Request): Promise<URLSearchParams> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new OAuthError("invalid_request", "Expected application/x-www-form-urlencoded", 415);
  }
  return new URLSearchParams(await boundedBody(req));
}

async function token(db: OAuthDb, req: Request, config: OAuthConfig): Promise<Response> {
  await takeRate(db, req, "token");
  const params = await form(req);
  const kind = requireParam(params, "grant_type", 50);
  if (kind !== "authorization_code" && kind !== "refresh_token") {
    throw new OAuthError("unsupported_grant_type", "Unsupported grant type");
  }
  const clientId = requireParam(params, "client_id", 200);
  const resource = requireParam(params, "resource");
  if (resource !== config.resource) throw new OAuthError("invalid_target", "Wrong MCP resource");
  if (params.has("scope")) normalizeScope(requireParam(params, "scope", 100));
  const secret = requireParam(params, kind === "authorization_code" ? "code" : "refresh_token", 100);
  const prefix = kind === "authorization_code" ? CODE_PREFIX : REFRESH_PREFIX;
  if (!new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(secret)) {
    throw new OAuthError("invalid_grant", "Invalid authorization grant");
  }
  const redirectUri = kind === "authorization_code" ? requireParam(params, "redirect_uri") : null;
  const challenge = kind === "authorization_code"
    ? await pkceChallenge(requireParam(params, "code_verifier", 128))
    : null;
  const accessToken = randomSecret(ACCESS_PREFIX);
  const refreshToken = randomSecret(REFRESH_PREFIX);
  const result = await rpc<{ error?: string; scope: string; expires_in: number }>(db, "mcp_oauth_exchange", {
    p_kind: kind,
    p_secret_hash: await sha256(secret),
    p_client_id: clientId,
    p_redirect_uri: redirectUri,
    p_challenge: challenge,
    p_resource: resource,
    p_access_hash: await sha256(accessToken),
    p_refresh_hash: await sha256(refreshToken),
  });
  if (result.error) throw new OAuthError(result.error, "Authorization grant is invalid or expired");
  return jsonResponse(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: result.expires_in,
      refresh_token: refreshToken,
      scope: result.scope,
    },
    200,
    true,
  );
}

async function revoke(db: OAuthDb, req: Request): Promise<Response> {
  await takeRate(db, req, "revoke");
  const params = await form(req);
  const clientId = requireParam(params, "client_id", 200);
  const value = requireParam(params, "token", 200);
  if (/^(smoa_|smor_)[A-Za-z0-9_-]{43}$/.test(value)) {
    await rpc(db, "mcp_oauth_revoke", { p_token_hash: await sha256(value), p_client_id: clientId });
  }
  return new Response(null, { status: 200, headers: PUBLIC_HEADERS });
}

export async function handleOAuthPublicRequest(db: OAuthDb, req: Request, config: OAuthConfig): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
    const path = pathOf(req);
    if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
      return jsonResponse(authorizationMetadata(config), 200, true);
    }
    if (
      req.method === "GET" &&
      (path === "/.well-known/oauth-protected-resource" ||
        path === "/.well-known/oauth-protected-resource/functions/v1/swarm-mcp")
    ) return jsonResponse(protectedResourceMetadata(config), 200, true);
    if (req.method === "POST" && path === "/oauth/register") return await register(db, req);
    if (req.method === "GET" && path === "/oauth/authorize") return await authorize(db, req, config);
    if (req.method === "POST" && path === "/oauth/token") return await token(db, req, config);
    if (req.method === "POST" && path === "/oauth/revoke") return await revoke(db, req);
    if (
      [
        "/oauth/register",
        "/oauth/authorize",
        "/oauth/token",
        "/oauth/revoke",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource",
      ].includes(path)
    ) {
      const response = jsonResponse({ error: "invalid_request", error_description: "Method not allowed" }, 405, true);
      response.headers.set(
        "Allow",
        path.includes("authorize") || path.includes(".well-known") ? "GET, OPTIONS" : "POST, OPTIONS",
      );
      return response;
    }
    return jsonResponse({ error: "not_found" }, 404, true);
  } catch (error) {
    return errorResponse(error, true);
  }
}
