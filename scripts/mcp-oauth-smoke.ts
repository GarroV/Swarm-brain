// End-to-end checks are restricted to our synthetic remote stand, reached over an SSH tunnel.
// No model API, production credentials or human messages are used.
import { assert, assertEquals } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (Deno.env.get("MCP_STAND_URL") || "http://localhost:18442")
  .replace(/\/$/, "");
const origin = new URL(base);
if (!["localhost", "127.0.0.1"].includes(origin.hostname)) {
  throw new Error("Use the isolated stand's SSH tunnel only");
}
const health = await fetch(`${base}/health`).then((r) => r.json());
assertEquals(health.stand, "swarm-mcp-chatgpt");

async function json(
  path: string,
  init?: RequestInit,
  want = 200,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, init);
  assertEquals(
    response.status,
    want,
    `${init?.method ?? "GET"} ${path.split("?")[0]}`,
  );
  return response.json();
}

const metadata = await json("/.well-known/oauth-protected-resource");
const resource = metadata.resource as string;
assertEquals(resource, `${base}/functions/v1/swarm-mcp`);
const authMetadata = await json("/.well-known/oauth-authorization-server");
assertEquals(authMetadata.issuer, base);
const noAuth = await fetch(resource, {
  method: "POST",
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  }),
});
assertEquals(noAuth.status, 401);
assert(noAuth.headers.get("WWW-Authenticate")?.includes("resource_metadata="));
await noAuth.body?.cancel();
console.log("PASS discovery + MCP OAuth challenge");

const callback = "https://chatgpt.com/connector/oauth/swarm-stand-check";
const registered = await json("/oauth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "ChatGPT stand check",
    redirect_uris: [callback],
    token_endpoint_auth_method: "none",
  }),
}, 201);
const clientId = registered.client_id as string;
const verifier = "stand-proof-" + crypto.randomUUID().replaceAll("-", "") +
  "-s256";
const hash = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(verifier),
);
const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll(
  "+",
  "-",
).replaceAll("/", "_").replaceAll("=", "");
const query = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: callback,
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource,
  scope: "mcp offline_access",
  state: "stand-state",
});
const authorization = await fetch(`${base}/oauth/authorize?${query}`, {
  redirect: "manual",
});
assertEquals(authorization.status, 302);
const requestId = new URL(authorization.headers.get("Location")!).searchParams
  .get("mcp_oauth")!;
await authorization.body?.cancel();
assert(requestId);

async function login(secondStep: boolean, user = 900009901): Promise<string> {
  const response = await fetch(
    `${base}/api/auth/login?user=${user}&second_step=${secondStep ? "1" : "0"}`,
    { redirect: "manual" },
  );
  assertEquals(response.status, 302);
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
  await response.body?.cancel();
  return cookie;
}
const cookie = await login(true);
const headers = {
  Cookie: cookie,
  Origin: base,
  "Content-Type": "application/json",
};
const detail = await json(
  `/api/mcp/oauth/authorize?request=${encodeURIComponent(requestId)}`,
  { headers },
);
assertEquals(detail.redirectHost, "chatgpt.com");
const blocked = await fetch(`${base}/api/mcp/oauth/authorize`, {
  method: "POST",
  headers: { ...headers, Cookie: await login(false) },
  body: JSON.stringify({ requestId, accept: true }),
});
assertEquals(blocked.status, 403);
await blocked.body?.cancel();
const csrf = await fetch(`${base}/api/mcp/oauth/authorize`, {
  method: "POST",
  headers: { ...headers, Origin: "https://untrusted.example" },
  body: JSON.stringify({ requestId, accept: true }),
});
assertEquals(csrf.status, 403);
await csrf.body?.cancel();
const decision = await json("/api/mcp/oauth/authorize", {
  method: "POST",
  headers,
  body: JSON.stringify({ requestId, accept: true }),
});
const redirect = new URL(decision.redirectUrl as string);
assertEquals(redirect.origin, "https://chatgpt.com");
assertEquals(redirect.searchParams.get("state"), "stand-state");
assertEquals(redirect.searchParams.get("iss"), base);
const code = redirect.searchParams.get("code")!;
console.log("PASS registration + consent + second-step gate + CSRF");

function token(
  params: Record<string, string>,
  want = 200,
): Promise<Record<string, unknown>> {
  return json("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, resource, ...params }),
  }, want);
}
let tokens = await token({
  grant_type: "authorization_code",
  code,
  code_verifier: verifier,
  redirect_uri: callback,
});
const client = new Client({
  name: "swarm-chatgpt-stand-smoke",
  version: "1.0",
});
const transport = new StreamableHTTPClientTransport(new URL(resource), {
  requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert(tools.tools.some((t: { name: string }) => t.name === "whoami"));
  const who = await client.callTool({
    name: "whoami",
    arguments: { requesting_user_id: 900009902 },
  });
  const text = JSON.stringify(who);
  assert(text.includes("900009901"));
  assert(!text.includes("900009902"));
  await client.callTool({ name: "get_tasks", arguments: {} });
} finally {
  await client.close();
}
console.log(
  "PASS official MCP SDK initialize + tools/list + identity + task read",
);
// Issue only on the synthetic stand; the installation command is never executed or printed.
const setup = await json("/api/mcp/token", {
  method: "POST",
  headers,
  body: "{}",
});
const staticToken = String(setup.oneLiner).match(
  /SWARM_TOKEN='(smcp_[a-zA-Z0-9]+)'/,
)?.[1];
assert(staticToken);
const staticClient = new Client({
  name: "swarm-static-regression",
  version: "1.0",
});
try {
  await staticClient.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${staticToken}` } },
    }),
  );
  const who = await staticClient.callTool({ name: "whoami", arguments: {} });
  assert(JSON.stringify(who).includes("900009901"));
} finally {
  await staticClient.close();
}
console.log("PASS existing static Claude token through official MCP SDK");
tokens = await token({
  grant_type: "refresh_token",
  refresh_token: tokens.refresh_token as string,
});
const connections = await json("/api/mcp/connections", { headers });
const rows = connections.connections as {
  id: string;
  clientName: string;
  lastSeenAt: string | null;
}[];
const grant = rows.find((r) =>
  r.clientName === "ChatGPT stand check" && r.lastSeenAt !== null
)!;
assert(grant);
await json(`/api/mcp/connections/${grant.id}`, { method: "DELETE", headers });
const revoked = await fetch(resource, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokens.access_token}`,
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "whoami", arguments: {} },
  }),
});
assertEquals(revoked.status, 401);
await revoked.body?.cancel();
await token({
  grant_type: "refresh_token",
  refresh_token: tokens.refresh_token as string,
}, 400);
console.log("PASS refresh + personal revoke + access/refresh rejection");
await token({
  grant_type: "authorization_code",
  code,
  code_verifier: verifier,
  redirect_uri: callback,
}, 400);
console.log("PASS authorization code replay rejected");
