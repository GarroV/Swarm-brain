// ВСЕХ функциях); перевод на голые спецификаторы из import-map из ветки непроверяем. См. _shared/agent-auth.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, verifyAgentToken } from "../_shared/agent-auth.ts";
import { signJWT } from "../_shared/jwt.ts";
import { logAccess } from "../_shared/access-events.ts";

// meeting-webtoken — обмен персонального токена рекордера на веб-сессию (тот же JWT, что в
// cookie roj_session браузера). Зачем: рекордер открывает панель с экраном /live в WKWebView;
// чтобы /live мог сохранять «пометки на полях» через /api (как в браузере), WebView нужна
// та же веб-сессия. Рекордер дёргает этот эндпоинт своим токеном (Bearer), получает JWT и
// вкидывает его cookie roj_session в WKWebView — дальше /live работает без изменений.
//
// Auth — тот же recorder-токен, что у claim/ingest/status (verifyAgentToken). Деплой --no-verify-jwt.
//
// ⚠️ Этот эндпоинт НЕ переводится на resolveActingIdentity вместе с остальными. Он печатает
// веб-доступ на 12 часов, а не право записать встречу: служебный агент, прошедший здесь
// «от имени человека», перестал бы быть записывающим и стал бы этим человеком в вебе.
// verifyAgentToken — дверь только для людей, и должна ею остаться.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEB_JWT_SECRET = Deno.env.get("WEB_JWT_SECRET");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// 12 часов: рекордеру хватает минут, входу владельца на превью веток (/api/auth/token) — рабочего дня.
const WEBTOKEN_TTL_SEC = 12 * 3600;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("OK", { status: 200 });
  }
  if (!WEB_JWT_SECRET) {
    return json({ ok: false, error: "WEB_JWT_SECRET not configured" }, 500);
  }

  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    throw e;
  }

  // Короткий срок без продления (1.2). Раньше выдавалась полная 30-дневная сессия, которую прокси веба ещё и продлевал, —
  // любой токен рекордера или MCP превращался в бесконечный вход в веб. Прокси короткий токен
  // не продлевает (isRenewableSession).
  const jwt = await signJWT(
    { telegram_id: identity.telegramId },
    WEB_JWT_SECRET,
    WEBTOKEN_TTL_SEC,
  );
  await logAccess(supabase, identity.telegramId, "web_access_exchanged", { via: "token", req });
  return json({ ok: true, jwt, telegram_id: identity.telegramId });
});
