import { signJWT, verifyTelegramWidget } from "../../_lib/jwt";

// Cloudflare Pages Function: GET /api/auth/telegram?id=&first_name=&hash=&auth_date=…
// Telegram Login Widget редиректит сюда. Проверяем подпись → ставим httpOnly cookie с JWT.
type Env = { TELEGRAM_BOT_TOKEN: string; WEB_JWT_SECRET: string };
type Ctx = { request: Request; env: Env };

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.TELEGRAM_BOT_TOKEN || !env.WEB_JWT_SECRET) {
    return new Response("Auth not configured", { status: 500 });
  }
  const url = new URL(request.url);
  const verified = await verifyTelegramWidget(url.searchParams, env.TELEGRAM_BOT_TOKEN);
  if (!verified) {
    return new Response("Invalid Telegram login", { status: 403 });
  }

  const jwt = await signJWT({ telegram_id: verified.telegram_id }, env.WEB_JWT_SECRET);
  const maxAge = 7 * 86400;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    },
  });
}
