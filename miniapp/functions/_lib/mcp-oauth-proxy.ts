import { functionsBase } from "./api-url";

type Env = { SWARM_API_URL?: string };

const PUBLIC_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke",
]);

/** Only protocol endpoints reach the public OAuth function; the consent UI uses the signed-in API. */
export async function proxyMcpOAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (!PUBLIC_PATHS.has(url.pathname)) {
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.delete("Host");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  try {
    const upstream = await fetch(
      `${functionsBase(env)}/swarm-oauth${url.pathname}${url.search}`,
      init,
    );
    const out = new Response(upstream.body, upstream);
    out.headers.delete("Set-Cookie");
    out.headers.set("Cache-Control", "no-store");
    out.headers.set("Referrer-Policy", "no-referrer");
    return out;
  } catch {
    return Response.json({ error: "temporarily_unavailable" }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

/** The cookie proxy must not let another origin approve a link or disconnect an app. */
export function mcpMutationAllowed(request: Request): boolean {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/mcp/")) return true;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  return request.headers.get("Origin") === url.origin &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site";
}
