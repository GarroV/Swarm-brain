import { callPasskey, isSameOrigin, jsonResponse, type PasskeyEnv, requireSession } from "../../../_lib/passkey-call";

// Cloudflare Pages Function: POST /api/auth/passkey/options
// Второй шаг входа (ключ доступа, #955): под сессией, выданной Google, просит у
// auth-passkey вызов. Режим выбирает сервер: get (подтвердить) — только если ключи есть И браузер
// прислал here=true (локальная метка); иначе create (сохранить палец, решение 19.10.2026). Сессию не меняет.
type Ctx = { request: Request; env: PasskeyEnv };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!isSameOrigin(request)) return jsonResponse({ error: "forbidden" }, 403);
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null) as { here?: unknown } | null;
  const here = body?.here === true;

  const r = await callPasskey(env, {
    op: "start",
    telegram_id: session.claims.telegram_id,
    origin: new URL(request.url).origin,
    here,
  });
  return jsonResponse(r.body, r.status);
}
