import { signJWT } from "../../_lib/jwt";

// Cloudflare Pages Function: GET /api/auth/demo?key=<DEMO_ACCESS_KEY>
// Demo-вход по СЕКРЕТНОЙ ссылке — выдаёт сессию зашитого demo-юзера (не Telegram-логин).
// Заказчик открывает ссылку → httpOnly cookie с JWT → попадает в demo-воркспейс.
//
// Изоляция «нет дыр в рабочие» держится НЕ здесь, а в swarm-api (барьер isDemo):
// эта сессия форсится в group_id='demo', не админ, не минтит токены. Здесь — только выдача
// сессии по секрету. Секрет (DEMO_ACCESS_KEY) — высокоэнтропийный, в env CF Pages.
const DEMO_USER_ID = 900000001;
const SESSION_MAX_AGE = 7 * 86400;

type Env = { WEB_JWT_SECRET: string; DEMO_ACCESS_KEY: string };
type Ctx = { request: Request; env: Env };

// Демо встраивается в <iframe> витрины garrov.github.io. Там кука обязана быть
// Partitioned (CHIPS): она ложится в отдельную «коробку» под сайтом витрины и
// (1) не затирает настоящую сессию человека на swarm-brain.pages.dev — без этого одно
// открытие витрины подменяло рабочий вход на демо (30.09.2026, у владельца);
// (2) работает и там, где сторонние куки запрещены — без неё iframe выпадал на /login,
// и вход оттуда вёл в прод. Открытое вкладкой демо — явное «войти в демо»: обычная кука.
export function demoSessionCookie(jwt: string, fetchDest: string | null): string {
  const base = `roj_session=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_MAX_AGE}`;
  return fetchDest === "iframe" ? `${base}; Partitioned` : base;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.WEB_JWT_SECRET || !env.DEMO_ACCESS_KEY) {
    return new Response("Demo not configured", { status: 500 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  // Секрет высокоэнтропийный → прямого сравнения достаточно (не подбирается по HTTP).
  if (!key || key !== env.DEMO_ACCESS_KEY) {
    return new Response("Forbidden", { status: 403 });
  }

  const jwt = await signJWT({ telegram_id: DEMO_USER_ID }, env.WEB_JWT_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      // SameSite=None: кросс-сайт iframe иначе не получит сессию. Безопасно: demo-сессия
      // изолирована в swarm-api. Реальный логин (telegram.ts) остаётся Lax.
      "Set-Cookie": demoSessionCookie(jwt, request.headers.get("Sec-Fetch-Dest")),
    },
  });
}
