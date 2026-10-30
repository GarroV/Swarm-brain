// Private remote stand only. Production uses Cloudflare Pages functions instead.
// Run through mcp-chatgpt-stand.ps1 on MUSPELHEIM; no local Mac server is required.
import { signJWT } from "../miniapp/functions/_lib/jwt.ts";
import { mcpMutationAllowed } from "../miniapp/functions/_lib/mcp-oauth-proxy.ts";

if (Deno.env.get("STAND_ONLY") !== "swarm-mcp-chatgpt") {
  throw new Error(
    "This gateway is exclusively for the isolated MCP ChatGPT stand",
  );
}

const port = Number(Deno.env.get("STAND_PORT") ?? 18442);
const secret = Deno.env.get("WEB_JWT_SECRET")!;
const loginUser = Number(Deno.env.get("STAND_LOGIN_USER"));
const allowedUsers = new Set(
  (Deno.env.get("STAND_LOGIN_USERS") ?? String(loginUser)).split(",").map(
    Number,
  ),
);
const staticDir = Deno.env.get("STAND_STATIC") ?? "miniapp/out";
const api = Deno.env.get("STAND_API") ??
  "http://swarm-chatgpt-api:8000/functions/v1/swarm-api";
const oauth = Deno.env.get("STAND_OAUTH") ?? "http://swarm-chatgpt-oauth:8000";
const mcp = Deno.env.get("STAND_MCP") ?? "http://swarm-chatgpt-mcp:8000";
const rest = Deno.env.get("STAND_REST") ?? "http://swarm-chatgpt-rest:3000";
const origin = Deno.env.get("WEB_BASE_URL") ?? `http://localhost:${port}`;
if (!secret || !loginUser || !URL.canParse(origin)) {
  throw new Error("Missing stand configuration");
}

const types: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

async function serveStatic(path: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  if (
    decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")
  ) {
    return new Response("Bad path", { status: 400 });
  }
  const relative = decoded === "/" ? "/index.html" : decoded;
  const candidates = relative.includes(".")
    ? [relative]
    : [`${relative}.html`, `${relative}/index.html`];
  for (const candidate of candidates) {
    try {
      const body = await Deno.readFile(`${staticDir}${candidate}`);
      const ext = candidate.split(".").at(-1) ?? "";
      return new Response(body, {
        headers: { "Content-Type": types[ext] ?? "application/octet-stream" },
      });
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotFound) &&
        !(error instanceof Deno.errors.IsADirectory)
      ) throw error;
    }
  }
  return new Response("Not found", { status: 404 });
}

async function proxy(
  request: Request,
  target: string,
  withSession = false,
): Promise<Response> {
  const headers = new Headers(request.headers);
  if (withSession) {
    const session = headers.get("Cookie")?.match(
      /(?:^|;\s*)roj_session=([^;]+)/,
    )?.[1];
    if (session) headers.set("Authorization", `Bearer ${session}`);
  }
  headers.delete("Cookie");
  headers.delete("Host");
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
  });
  const responseHeaders = new Headers(response.headers);
  for (
    const name of ["content-encoding", "content-length", "transfer-encoding"]
  ) responseHeaders.delete(name);
  if (withSession) {
    for (const name of responseHeaders.keys()) {
      if (name.startsWith("access-control-")) responseHeaders.delete(name);
    }
  }
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

Deno.serve({ hostname: "0.0.0.0", port }, async (request) => {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/health") {
      return Response.json({ ok: true, stand: "swarm-mcp-chatgpt" });
    }
    if (url.pathname === "/api/auth/login" && request.method === "GET") {
      const user = Number(url.searchParams.get("user") ?? loginUser);
      if (!allowedUsers.has(user)) {
        return new Response("Unknown stand user", { status: 403 });
      }
      const jwt = await signJWT({
        telegram_id: user,
        second_step: url.searchParams.get("second_step") !== "0",
      }, secret);
      const next = new URL(url.searchParams.get("next") ?? "/", origin);
      if (next.origin !== new URL(origin).origin) {
        return new Response("Bad next", { status: 400 });
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: next.pathname + next.search + next.hash,
          "Set-Cookie":
            `roj_session=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (url.pathname === "/api/auth/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/login",
          "Set-Cookie":
            "roj_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }
    if (url.pathname.startsWith("/api/")) {
      if (!mcpMutationAllowed(request)) {
        return new Response("Origin required", { status: 403 });
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers.get("Origin") !== origin
      ) {
        return new Response("Origin required", { status: 403 });
      }
      return await proxy(
        request,
        `${api}${url.pathname.slice(4)}${url.search}`,
        true,
      );
    }
    if (
      url.pathname.startsWith("/oauth/") ||
      url.pathname.startsWith("/.well-known/")
    ) {
      const headers = new Headers(request.headers);
      headers.delete("Cookie");
      headers.delete("Authorization");
      return await proxy(
        new Request(request, { headers }),
        `${oauth}/functions/v1/swarm-oauth${url.pathname}${url.search}`,
      );
    }
    if (url.pathname.startsWith("/functions/v1/swarm-mcp")) {
      return await proxy(request, `${mcp}${url.pathname}${url.search}`);
    }
    if (url.pathname.startsWith("/rest/v1")) {
      return await proxy(
        request,
        `${rest}${url.pathname.slice("/rest/v1".length)}${url.search}`,
      );
    }
    return await serveStatic(url.pathname);
  } catch (error) {
    console.error(
      "stand request failed",
      error instanceof Error ? error.name : "Error",
    );
    return Response.json({ error: "stand_upstream_unavailable" }, {
      status: 502,
    });
  }
});
