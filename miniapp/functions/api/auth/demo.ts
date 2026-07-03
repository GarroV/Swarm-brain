import { signJWT } from "../../_lib/jwt";

// Cloudflare Pages Function: GET /api/auth/demo?key=<DEMO_ACCESS_KEY>
// Demo-вход по СЕКРЕТНОЙ ссылке — выдаёт сессию зашитого demo-юзера (не Telegram-логин).
// Заказчик открывает ссылку → httpOnly cookie с JWT → попадает в demo-воркспейс.
//
// Изоляция «нет дыр в рабочие» держится НЕ здесь, а в swarm-api (барьер isDemo):
// эта сессия форсится в group_id='demo', не админ, не минтит токены. Здесь — только выдача
// сессии по секрету. Секрет (DEMO_ACCESS_KEY) — высокоэнтропийный, в env CF Pages.
const DEMO_USER_ID = 900000001;

type Env = { WEB_JWT_SECRET: string; DEMO_ACCESS_KEY: string };
type Ctx = { request: Request; env: Env };

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
  const maxAge = 7 * 86400;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    },
  });
}
