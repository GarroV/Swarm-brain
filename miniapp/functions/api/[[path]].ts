// Cloudflare Pages Function: прокси /api/* → swarm-api (same-origin для фронта).
// Ключ варианта B+: httpOnly-cookie roj_session недоступна JS и не уходит cross-origin,
// поэтому здесь, на сервере, перекладываем её в Authorization: Bearer при форварде.
// Telegram Mini App шлёт Authorization: tma <initData> — пробрасываем как есть.
//
// Здесь же живёт ПРОДЛЕНИЕ сессии (issue #50): раз в сутки активной работы cookie
// переиздаётся с новым сроком, поэтому человек, который пользуется сервисом, не вылетает
// никогда. Это единственная точка, через которую ходит весь фронт, — другого места, где
// можно поймать «пользователь ещё жив», у нас нет.
import { verifyJWT, signJWT, shouldRefreshSession, SESSION_TTL_SEC } from "../_lib/jwt";

type Env = { SWARM_API_URL: string; WEB_JWT_SECRET?: string };
type Ctx = { request: Request; env: Env };

export async function onRequest(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.SWARM_API_URL) return new Response("API not configured", { status: 500 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, "");
  const target = `${env.SWARM_API_URL.replace(/\/$/, "")}/${path}${url.search}`;

  const headers = new Headers(request.headers);
  const incomingAuth = headers.get("Authorization") ?? "";
  let sessionToken: string | null = null;
  if (!incomingAuth.startsWith("tma ")) {
    const cookie = request.headers.get("Cookie") ?? "";
    const m = cookie.match(/(?:^|;\s*)roj_session=([^;]+)/);
    if (m) {
      sessionToken = m[1];
      headers.set("Authorization", `Bearer ${sessionToken}`);
    }
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

  const res = await fetch(target, init);
  const renewed = await renewSessionCookie(sessionToken, res.status, env.WEB_JWT_SECRET);
  if (!renewed) return res;

  // Пересобираем ответ, потому что headers у ответа fetch иммутабельны. Тело передаём
  // потоком как есть — не буферизуем, чтобы не ломать стриминг.
  const out = new Response(res.body, res);
  out.headers.append("Set-Cookie", renewed);
  return out;
}

// Возвращает готовый Set-Cookie, если сессию пора продлить, иначе null.
// Вынесено отдельно, чтобы решение «продлевать или нет» читалось без прокси-обвязки.
async function renewSessionCookie(
  token: string | null,
  upstreamStatus: number,
  secret: string | undefined,
): Promise<string | null> {
  if (!token || !secret) return null;
  // Апстрим не признал эту сессию — продлевать нечего.
  if (upstreamStatus === 401 || upstreamStatus === 403) return null;

  try {
    const claims = await verifyJWT(token, secret);
    if (!claims) return null; // истёкшая/битая подпись — пусть человек войдёт заново
    if (!shouldRefreshSession(claims.exp, Math.floor(Date.now() / 1000))) return null;
    const fresh = await signJWT({ telegram_id: claims.telegram_id }, secret);
    return `roj_session=${fresh}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
  } catch {
    // Продление — удобство, а не авторизация: сбой крипты не должен ронять запрос к API.
    // Худшее следствие — сессия доживёт до своего срока и попросит войти заново.
    return null;
  }
}
