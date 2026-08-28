import { verifyState, hmacSign } from "../../../_lib/oauth-state";
import { type GoogleName, hasCalendarScope, nameSigPayload, normalizeName } from "../../../_lib/google-name";
import { signJWT, SESSION_TTL_SEC } from "../../../_lib/jwt";

// CF Pages Function: GET /api/auth/google/callback — Google вернул code.
// Обмен кода → userinfo → сверка verified email + домена → резолв личности через Supabase
// auth-resolve (подпись HMAC на WEB_JWT_SECRET) → mint roj_session → кука на pages.dev.
type Env = { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; WEB_JWT_SECRET: string };
type Ctx = { request: Request; env: Env };

const ALLOWED_DOMAIN = "dodobrands.io";
const RESOLVE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/auth-resolve";
const CALENDAR_LINK_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/google-oauth/link";

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
  // Устойчивость к опечаткам в CF-env: нормализуем client_id (случайный http://), тримим secret.
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokRes.ok) return loginErr(origin, "token");
  const tok = await tokRes.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tok.access_token) return loginErr(origin, "token");

  // 2) userinfo → verified email + домен
  const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!uiRes.ok) return loginErr(origin, "userinfo");
  const ui = await uiRes.json() as {
    email?: string; email_verified?: boolean | string; given_name?: string; family_name?: string;
  };
  const email = String(ui.email ?? "").toLowerCase().trim();
  const verified = ui.email_verified === true || ui.email_verified === "true";
  if (!email || !verified || email.split("@")[1] !== ALLOWED_DOMAIN) return loginErr(origin, "domain");

  // 3) резолв личности через Supabase (server-to-server, HMAC на WEB_JWT_SECRET).
  // Имя из Google идёт тем же запросом и ВХОДИТ в подпись: auth-resolve принимает его только с
  // подписью email|given|family, иначе имя можно было бы подменить реплеем. Заполняет пустой
  // user_profiles.first_name — источник дефолтного названия записи без календаря (#184).
  const name: GoogleName = { given: normalizeName(ui.given_name), family: normalizeName(ui.family_name) };
  const sig = await hmacSign(env.WEB_JWT_SECRET, nameSigPayload(email, name));
  const rRes = await fetch(RESOLVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, sig, given_name: name.given ?? "", family_name: name.family ?? "" }),
  });
  if (!rRes.ok) return loginErr(origin, "resolve");
  const r = await rRes.json() as { found?: boolean; telegram_id?: number | null; id?: number };
  if (!r.found) return loginErr(origin, "not_allowed");
  // Обычно не наступает: email-only приглашению auth-resolve сам присваивает синтетический
  // telegram_id (-id). Пустой id тут — сбой резолва (гонка/ошибка записи), а не «ждём Telegram».
  if (r.telegram_id == null) return loginErr(origin, "link_telegram");

  // 4) календарь, если человек оставил галочку на экране согласия.
  // Проверяем ФАКТИЧЕСКИ выданные scope, а не предполагаем: Google требует «handle any denial of
  // scopes by disabling relevant features». Снял галочку — просто не привязываем, вход идёт дальше
  // (решение владельца 2026-08-28). refresh_token Google отдаёт только при первом согласии на
  // календарь: у кого он уже есть в базе, тут будет пусто — перетирать нечем и не нужно.
  if (hasCalendarScope(tok.scope) && tok.refresh_token) {
    try {
      const linkSig = await hmacSign(env.WEB_JWT_SECRET, `${r.telegram_id}|${tok.refresh_token}`);
      const linkRes = await fetch(CALENDAR_LINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: r.telegram_id, refresh_token: tok.refresh_token, sig: linkSig }),
      });
      // Календарь — не причина не пустить человека в продукт: он увидит «не подключён» в
      // Настройках и привяжет кнопкой. Молча считать привязанным нельзя.
      if (!linkRes.ok) console.error("google-login: календарь не привязался", linkRes.status);
    } catch (e) {
      console.error("google-login: календарь не привязался", e);
    }
  }

  // 5) сессия
  const jwt = await signJWT({ telegram_id: r.telegram_id }, env.WEB_JWT_SECRET);
  const maxAge = SESSION_TTL_SEC;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}${st.next}`,
      "Set-Cookie": `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    },
  });
}
