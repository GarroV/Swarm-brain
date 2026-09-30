import { clearNonceCookie, hmacSign, OAUTH_NONCE_COOKIE, readCookie, verifyState } from "../../../_lib/oauth-state";
import { type GoogleName, hasCalendarScope, nameSigPayload, normalizeName } from "../../../_lib/google-name";
import { signJWT, SESSION_TTL_SEC, verifyJWT } from "../../../_lib/jwt";
import { swarmApiUrl } from "../../../_lib/api-url";

// CF Pages Function: GET /api/auth/google/callback — Google вернул code.
// Обмен кода → userinfo → сверка verified email + домена → резолв личности через Supabase
// auth-resolve (подпись HMAC на WEB_JWT_SECRET) → mint roj_session → кука на pages.dev.
// Тот же адрес обслуживает и подключение календаря (state.flow=calendar, см. start.ts): Google
// знает один redirect_uri, и второй регистрировать не нужно.
// state принимается только вместе с кукой OAUTH_NONCE_COOKIE из start; кука гасится при любом исходе.
type Env = { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; WEB_JWT_SECRET: string; SWARM_API_URL?: string };
type Ctx = { request: Request; env: Env };

const ALLOWED_DOMAIN = "dodobrands.io";
const RESOLVE_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/auth-resolve";
const CALENDAR_LINK_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/google-oauth/link";

type GoogleTokens = { access_token?: string; refresh_token?: string; scope?: string };

function redirect(location: string, extraCookie?: string): Response {
  const headers = new Headers({ Location: location });
  headers.append("Set-Cookie", clearNonceCookie());
  if (extraCookie) headers.append("Set-Cookie", extraCookie);
  return new Response(null, { status: 302, headers });
}
function loginErr(origin: string, err: string): Response {
  return redirect(`${origin}/login?err=${encodeURIComponent(err)}`);
}
function textErr(status: number, text: string): Response {
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  headers.append("Set-Cookie", clearNonceCookie());
  return new Response(text, { status, headers });
}

async function exchangeCode(env: Env, origin: string, code: string): Promise<GoogleTokens | null> {
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
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokRes.ok) return null;
  return await tokRes.json() as GoogleTokens;
}

async function linkCalendar(env: Env, telegramId: number, refreshToken: string): Promise<boolean> {
  const linkSig = await hmacSign(env.WEB_JWT_SECRET, `${telegramId}|${refreshToken}`);
  const linkRes = await fetch(CALENDAR_LINK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id: telegramId, refresh_token: refreshToken, sig: linkSig }),
  }).catch((e) => {
    console.error("google-oauth/link недоступен", e);
    return null;
  });
  if (linkRes && !linkRes.ok) console.error("google-oauth/link ответил", linkRes.status);
  return linkRes?.ok === true;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const origin = url.origin;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.WEB_JWT_SECRET) {
    return textErr(500, "Google login не настроен (нет кредов в CF)");
  }
  const code = url.searchParams.get("code") ?? "";
  const st = await verifyState(
    env.WEB_JWT_SECRET,
    url.searchParams.get("state") ?? "",
    readCookie(request.headers.get("Cookie"), OAUTH_NONCE_COOKIE),
  );
  if (!code || !st) return loginErr(origin, "state");
  if (st.flow === "calendar") return await calendarCallback(request, env, origin, code, st.tid);

  // 1) обмен кода на токены
  const tok = await exchangeCode(env, origin, code);
  if (!tok?.access_token) return loginErr(origin, "token");

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
      // Календарь — не причина не пустить человека в продукт: он увидит «не подключён» в
      // Настройках и привяжет кнопкой. Молча считать привязанным нельзя.
      if (!(await linkCalendar(env, r.telegram_id, tok.refresh_token))) {
        console.error("google-login: календарь не привязался");
      }
    } catch (e) {
      console.error("google-login: календарь не привязался", e);
    }
  }

  // 5) сессия
  const jwt = await signJWT({ telegram_id: r.telegram_id }, env.WEB_JWT_SECRET);
  return redirect(
    `${origin}${st.next}`,
    `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`,
  );
}

// Подключение календаря к текущей сессии. Привязка идёт только к тому, кто начал поток:
// сессия в этом браузере обязана принадлежать тому же человеку, что записан в state, и быть
// живой для swarm-api (GET /me — там же проверяется отзыв сессий).
async function calendarCallback(
  request: Request,
  env: Env,
  origin: string,
  code: string,
  stateTid: number | null,
): Promise<Response> {
  const session = readCookie(request.headers.get("Cookie"), "roj_session");
  const claims = session ? await verifyJWT(session, env.WEB_JWT_SECRET) : null;
  if (!session || !claims || claims.telegram_id !== stateTid) {
    return textErr(403, "Calendar was not connected: sign in to Swarm in this browser and try again. / Календарь не подключён: войдите в Swarm в этом браузере и повторите.");
  }
  const me = await fetch(`${swarmApiUrl(env)}/me`, { headers: { Authorization: `Bearer ${session}` } }).catch(() => null);
  if (!me?.ok) {
    return textErr(403, "Calendar was not connected: your session has ended, sign in again. / Календарь не подключён: сессия закончилась, войдите заново.");
  }
  const tok = await exchangeCode(env, origin, code);
  if (!tok?.access_token) return textErr(502, "Google did not issue a token, try again. / Google не выдал токен, повторите.");
  if (!hasCalendarScope(tok.scope)) {
    return textErr(400, "Calendar access was not granted. / Доступ к календарю не выдан.");
  }
  if (!tok.refresh_token) {
    // refresh_token приходит только при первом согласии; consent в start уже стоит.
    return textErr(400, "Google did not issue a refresh token: revoke Swarm access in your Google account and connect again. / Google не выдал refresh_token: отзовите доступ Swarm в аккаунте Google и подключитесь заново.");
  }
  if (!(await linkCalendar(env, claims.telegram_id, tok.refresh_token))) {
    console.error("google-calendar: привязка не сохранилась", claims.telegram_id);
    return textErr(500, "Calendar was not saved, try again later. / Календарь не сохранился, повторите позже.");
  }
  return redirect(`${origin}/?google=connected`);
}
