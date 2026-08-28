import { signState } from "../../../_lib/oauth-state";

// CF Pages Function: GET /api/auth/google/start?next=… → редирект на Google consent.
// Живёт на домене pages.dev (как /api/auth/telegram), чтобы кука встала на нужный домен.
import { LOGIN_SCOPES } from "../../../_lib/google-name";

type Env = { GOOGLE_CLIENT_ID: string; WEB_JWT_SECRET: string };
type Ctx = { request: Request; env: Env };

const ALLOWED_DOMAIN = "dodobrands.io";

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.GOOGLE_CLIENT_ID || !env.WEB_JWT_SECRET) {
    return new Response("Google login не настроен (нет GOOGLE_CLIENT_ID/WEB_JWT_SECRET в CF)", { status: 500 });
  }
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/";
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  // Устойчивость к опечаткам в CF-env: срезаем случайный http(s):// и хвостовые слэши/пробелы.
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  // Календарь просим здесь же: «вошёл через Google — календарь привязан» (решение владельца
  // 2026-08-28). Google покажет granular-экран; снятая галочка календаря вход НЕ ломает.
  auth.searchParams.set("scope", LOGIN_SCOPES);
  // refresh_token нужен серверу, чтобы читать календарь без человека у экрана. Без offline
  // Google отдаёт только короткоживущий access_token, и привязка была бы фикцией.
  auth.searchParams.set("access_type", "offline");
  // Уже выданные права переносим, чтобы не терять их при добавлении новых.
  auth.searchParams.set("include_granted_scopes", "true");
  auth.searchParams.set("hd", ALLOWED_DOMAIN); // подсказка Google показывать аккаунты домена
  auth.searchParams.set("prompt", "select_account");
  auth.searchParams.set("state", await signState(env.WEB_JWT_SECRET, next));
  return Response.redirect(auth.toString(), 302);
}
