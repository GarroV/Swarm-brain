import { callPasskey, isSameOrigin, jsonResponse, type PasskeyEnv, requireSession } from "../../../_lib/passkey-call";

// Cloudflare Pages Function: POST /api/auth/passkey/enroll-options  { token }
// «Добавить устройство» (решение 17.10.2026): телефон открыл одноразовую ссылку под СВОЕЙ сессией;
// просим у auth-passkey вызов регистрации ключа этого устройства. Человека называет кука, а не тело:
// ссылка чужого человека под этой сессией не сработает (auth-passkey ответит invalid). Сессию не меняет.
type Ctx = { request: Request; env: PasskeyEnv };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!isSameOrigin(request)) return jsonResponse({ error: "forbidden" }, 403);
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  if (typeof body?.token !== "string") return jsonResponse({ ok: false, reason: "invalid" }, 400);
  const r = await callPasskey(env, {
    op: "enroll_start",
    telegram_id: session.claims.telegram_id,
    origin: new URL(request.url).origin,
    token: body.token,
  });
  return jsonResponse(r.body, r.status);
}
