import { verifyState, hmacSign } from "../../../_lib/oauth-state";
import { signJWT } from "../../../_lib/jwt";

// CF Pages Function: GET /api/auth/google/callback — Google вернул code.
// Обмен кода → userinfo → сверка verified email + домена → резолв личности через Supabase
// auth-resolve (подпись HMAC на WEB_JWT_SECRET) → mint roj_session → кука на pages.dev.
type Env = { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; WEB_JWT_SECRET: string };
type Ctx = { request: Request; env: Env };

const ALLOWED_DOMAIN = "dodobrands.io";
const RESOLVE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/auth-resolve";

function loginErr(origin: string, err: string): Response {
  return Response.redirect(`${origin}/login?err=${encodeURIComponent(err)}`, 302);
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const origin = url.origin;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.WEB_JWT_SECRET) {
    return new Response("Google login не настроен (нет кредов в CF)", { status: 500 });
  }
  const code = url.searchParams.get("code") ?? "";
  const st = await verifyState(env.WEB_JWT_SECRET, url.searchParams.get("state") ?? "");
  if (!code || !st) return loginErr(origin, "state");

  // 1) обмен кода на токены
  const redirectUri = `${origin}/api/auth/google/callback`;
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokRes.ok) return loginErr(origin, "token");
  const tok = await tokRes.json() as { access_token?: string };
  if (!tok.access_token) return loginErr(origin, "token");

  // 2) userinfo → verified email + домен
  const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!uiRes.ok) return loginErr(origin, "userinfo");
  const ui = await uiRes.json() as { email?: string; email_verified?: boolean | string };
  const email = String(ui.email ?? "").toLowerCase().trim();
  const verified = ui.email_verified === true || ui.email_verified === "true";
  if (!email || !verified || email.split("@")[1] !== ALLOWED_DOMAIN) return loginErr(origin, "domain");

  // 3) резолв личности через Supabase (server-to-server, HMAC на WEB_JWT_SECRET)
  const sig = await hmacSign(env.WEB_JWT_SECRET, email);
  const rRes = await fetch(RESOLVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, sig }),
  });
  if (!rRes.ok) return loginErr(origin, "resolve");
  const r = await rRes.json() as { found?: boolean; telegram_id?: number | null; id?: number };
  if (!r.found) return loginErr(origin, "not_allowed");
  if (r.telegram_id == null) return loginErr(origin, "link_telegram"); // email-only ждёт Ф3

  // 4) сессия
  const jwt = await signJWT({ telegram_id: r.telegram_id }, env.WEB_JWT_SECRET);
  const maxAge = 7 * 86400;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}${st.next}`,
      "Set-Cookie": `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    },
  });
}
