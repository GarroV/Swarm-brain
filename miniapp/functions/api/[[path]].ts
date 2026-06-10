// Cloudflare Pages Function: прокси /api/* → swarm-api (same-origin для фронта).
// Ключ варианта B+: httpOnly-cookie roj_session недоступна JS и не уходит cross-origin,
// поэтому здесь, на сервере, перекладываем её в Authorization: Bearer при форварде.
// Telegram Mini App шлёт Authorization: tma <initData> — пробрасываем как есть.
type Env = { SWARM_API_URL: string };
type Ctx = { request: Request; env: Env };

export async function onRequest(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.SWARM_API_URL) return new Response("API not configured", { status: 500 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, "");
  const target = `${env.SWARM_API_URL.replace(/\/$/, "")}/${path}${url.search}`;

  const headers = new Headers(request.headers);
  const incomingAuth = headers.get("Authorization") ?? "";
  if (!incomingAuth.startsWith("tma ")) {
    const cookie = request.headers.get("Cookie") ?? "";
    const m = cookie.match(/(?:^|;\s*)roj_session=([^;]+)/);
    if (m) headers.set("Authorization", `Bearer ${m[1]}`);
  }
  headers.delete("Cookie");
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

  return fetch(target, init);
}
