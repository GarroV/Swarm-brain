import { callPasskey, isSameOrigin, jsonResponse, type PasskeyEnv, requireSession } from "../../../_lib/passkey-call";

// Cloudflare Pages Function: POST /api/auth/passkey/options
// Второй шаг входа (ключ доступа, #955): под сессией, выданной Google или Telegram, просит у
// auth-passkey вызов. Режим выбирает сервер по ключам человека: нет ни одного — create (сохранить
// палец), есть — только get (подтвердить). Сессию не меняет.
type Ctx = { request: Request; env: PasskeyEnv };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!isSameOrigin(request)) return jsonResponse({ error: "forbidden" }, 403);
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const r = await callPasskey(env, {
    op: "start",
    telegram_id: session.claims.telegram_id,
    origin: new URL(request.url).origin,
  });
  return jsonResponse(r.body, r.status);
}
