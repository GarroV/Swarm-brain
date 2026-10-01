import { newNonce, nonceCookie, readCookie, signState } from "../../../_lib/oauth-state";
import { verifyJWT } from "../../../_lib/jwt";
import { DEMO_USER_ID } from "../demo";

// CF Pages Function: GET /api/auth/google/start?next=… → редирект на consent Google.
// Живёт на домене pages.dev (как /api/auth/telegram), чтобы кука встала на нужный домен.
//   • flow=login (по умолчанию) — вход через Google.
//   • flow=calendar — подключение Google-календаря к ТЕКУЩЕЙ сессии (кнопка в Настройках).
//     До 2026-09-30 этот поток жил в edge-функции google-oauth на домене supabase.co.
// В обоих случаях ставим короткую httpOnly-куку с одноразовым значением — callback сверит
// её со state (см. _lib/oauth-state.ts).
import { CALENDAR_SCOPE, LOGIN_SCOPES } from "../../../_lib/google-name";

type Env = { GOOGLE_CLIENT_ID: string; WEB_JWT_SECRET: string };
type Ctx = { request: Request; env: Env };

const ALLOWED_DOMAIN = "dodobrands.io";

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.GOOGLE_CLIENT_ID || !env.WEB_JWT_SECRET) {
    return new Response("Google login не настроен (нет GOOGLE_CLIENT_ID/WEB_JWT_SECRET в CF)", { status: 500 });
  }
  const url = new URL(request.url);
  const flow = url.searchParams.get("flow") === "calendar" ? "calendar" : "login";
  const next = url.searchParams.get("next") ?? "/";
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  // Устойчивость к опечаткам в CF-env: срезаем случайный http(s):// и хвостовые слэши/пробелы.
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  let tid: number | null = null;
  if (flow === "calendar") {
    const session = readCookie(request.headers.get("Cookie"), "roj_session");
    const claims = session ? await verifyJWT(session, env.WEB_JWT_SECRET) : null;
    if (!claims) {
      return new Response("Sign in to Swarm first. / Сначала войдите в Swarm.", { status: 401 });
    }
    // Демо-сессия общая для всех посетителей витрины: календарь одного увидели бы следующие
    // (issue #573). Тот же отказ стоит в swarm-api и в google-oauth/link.
    if (claims.telegram_id === DEMO_USER_ID) {
      return new Response("Integrations cannot be connected in the demo. / В демо интеграции не подключаются.", {
        status: 403,
      });
    }
    tid = claims.telegram_id;
  }

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  // refresh_token нужен серверу, чтобы читать календарь без человека у экрана. Без offline
  // Google отдаёт только короткоживущий access_token, и привязка была бы фикцией.
  auth.searchParams.set("access_type", "offline");
  if (flow === "calendar") {
    // Только чтение событий; consent — чтобы Google точно отдал refresh_token (он приходит
    // лишь при согласии, а этот поток — ремонтный путь для тех, у кого привязки нет).
    auth.searchParams.set("scope", CALENDAR_SCOPE);
    auth.searchParams.set("prompt", "consent");
  } else {
    // Календарь просим здесь же: «вошёл через Google — календарь привязан» (решение владельца
    // 2026-08-28). Google покажет granular-экран; снятая галочка календаря вход НЕ ломает.
    auth.searchParams.set("scope", LOGIN_SCOPES);
    // Уже выданные права переносим, чтобы не терять их при добавлении новых.
    auth.searchParams.set("include_granted_scopes", "true");
    auth.searchParams.set("hd", ALLOWED_DOMAIN); // подсказка Google показывать аккаунты домена
    auth.searchParams.set("prompt", "select_account");
  }
  const nonce = newNonce();
  auth.searchParams.set("state", await signState(env.WEB_JWT_SECRET, { flow, next, nonce, tid }));
  return new Response(null, {
    status: 302,
    headers: { Location: auth.toString(), "Set-Cookie": nonceCookie(nonce) },
  });
}
