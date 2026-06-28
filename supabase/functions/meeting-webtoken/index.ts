import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";
import { signJWT } from "../_shared/jwt.ts";

// meeting-webtoken — обмен персонального токена рекордера на веб-сессию (тот же JWT, что в
// cookie roj_session браузера). Зачем: рекордер открывает панель с экраном /live в WKWebView;
// чтобы /live мог сохранять «пометки на полях» через /api (как в браузере), WebView нужна
// та же веб-сессия. Рекордер дёргает этот эндпоинт своим токеном (Bearer), получает JWT и
// вкидывает его cookie roj_session в WKWebView — дальше /live работает без изменений.
//
// Auth — тот же recorder-токен, что у claim/ingest/status (verifyAgentToken). Деплой --no-verify-jwt.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEB_JWT_SECRET = Deno.env.get("WEB_JWT_SECRET");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return new Response("OK", { status: 200 });
  if (!WEB_JWT_SECRET) return json({ ok: false, error: "WEB_JWT_SECRET not configured" }, 500);

  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ ok: false, error: e.message }, e.status);
    throw e;
  }

  // Срок как у браузерной сессии (signJWT default 7 дней).
  const jwt = await signJWT({ telegram_id: identity.telegramId }, WEB_JWT_SECRET);
  return json({ ok: true, jwt, telegram_id: identity.telegramId });
});
