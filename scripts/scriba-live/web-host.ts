// Веб стенда живого прогона бота scriba (T004): собранный miniapp + то, что в проде делает
// Cloudflare Pages Function (miniapp/functions/api/[[path]].ts), — перекладка cookie-сессии
// в `Authorization: Bearer` и форвард /api/* в swarm-api с ветки.
//
// Вход — по ссылке стенда, а не через Telegram Login Widget: у стенда нет бота Telegram.
//   GET /api/auth/local?key=<STAND_LOGIN_KEY>  → cookie roj_session владельца стенда, редирект на /
// Ключ случайный на стенд, живёт в state/stand.env на MUSPELHEIM; ссылку печатает
// `scripts/scriba-live.sh login-url`. Cookie без Secure: стенд открывается по http через Tailscale.

import { signJWT } from "../../supabase/functions/_shared/jwt.ts";

const PORT = Number(Deno.env.get("STAND_PORT") ?? "8000");
const ROOT = Deno.env.get("WEB_ROOT") ?? "/web";
const FUNCTIONS_URL = (Deno.env.get("FUNCTIONS_URL") ?? "").replace(/\/$/, "");
const SECRET = Deno.env.get("WEB_JWT_SECRET") ?? "";
const LOGIN_KEY = Deno.env.get("STAND_LOGIN_KEY") ?? "";
const OWNER = Number(Deno.env.get("STAND_OWNER_ID") ?? "0");
const SESSION_SECONDS = 7 * 86400;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  woff2: "font/woff2",
};

async function login(url: URL): Promise<Response> {
  if (!LOGIN_KEY || url.searchParams.get("key") !== LOGIN_KEY) return new Response("Forbidden", { status: 403 });
  const jwt = await signJWT({ telegram_id: OWNER }, SECRET, SESSION_SECONDS);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `roj_session=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`,
    },
  });
}

async function api(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\//, "");
  const headers = new Headers(req.headers);
  const session = (req.headers.get("Cookie") ?? "").match(/(?:^|;\s*)roj_session=([^;]+)/);
  if (session && !headers.get("Authorization")) headers.set("Authorization", `Bearer ${session[1]}`);
  headers.delete("Cookie");
  headers.delete("Host");
  return await fetch(`${FUNCTIONS_URL}/swarm-api/${path}${url.search}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
  });
}

async function file(pathname: string): Promise<Response> {
  const clean = decodeURIComponent(pathname).replace(/\.\.+/g, "");
  const candidates = [clean, `${clean}.html`, `${clean.replace(/\/$/, "")}/index.html`];
  for (const candidate of candidates) {
    try {
      const full = `${ROOT}${candidate}`;
      const stat = await Deno.stat(full);
      if (!stat.isFile) continue;
      const ext = full.split(".").pop() ?? "";
      const headers = new Headers({ "Content-Type": TYPES[ext] ?? "application/octet-stream" });
      // Service worker и HTML не кэшируем: стенд пересобирается, старый бандл вводит в заблуждение.
      if (ext === "html" || candidate.endsWith("sw.js")) headers.set("Cache-Control", "no-store");
      return new Response(await Deno.readFile(full), { headers });
    } catch {
      // следующий кандидат
    }
  }
  return new Response(await Deno.readFile(`${ROOT}/404.html`).catch(() => new Uint8Array()), {
    status: 404,
    headers: { "Content-Type": TYPES.html },
  });
}

Deno.serve({ hostname: "0.0.0.0", port: PORT, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/api/auth/local") return await login(url);
    if (url.pathname === "/api/auth/logout") {
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": "roj_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" },
      });
    }
    if (url.pathname.startsWith("/api/")) return await api(req, url);
    return await file(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (error) {
    console.error(`[web] ${req.method} ${url.pathname}: ${String(error)}`);
    return new Response("stand web error", { status: 502 });
  }
});
console.log(`[web] стенд слушает :${PORT}, статика ${ROOT}, API → ${FUNCTIONS_URL}/swarm-api`);
