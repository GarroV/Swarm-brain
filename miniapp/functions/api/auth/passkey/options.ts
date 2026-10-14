import { callPasskey, isSameOrigin, jsonResponse, type PasskeyEnv, requireSession } from "../../../_lib/passkey-call";

// Cloudflare Pages Function: POST /api/auth/passkey/options  { here: boolean }
// Второй шаг входа (ключ доступа, #955): под сессией, выданной Google или Telegram, просит у
// auth-passkey вызов. `here` — в браузере есть метка «ключ тут сохранён». Ответ — режим и параметры
// для navigator.credentials: create (сохранить палец) или get (подтвердить его). Сессию не меняет.
type Ctx = { request: Request; env: PasskeyEnv };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!isSameOrigin(request)) return jsonResponse({ error: "forbidden" }, 403);
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null) as { here?: unknown } | null;
  const r = await callPasskey(env, {
    op: "start",
    telegram_id: session.claims.telegram_id,
    origin: new URL(request.url).origin,
    here: body?.here === true,
  });
  return jsonResponse(r.body, r.status);
}
