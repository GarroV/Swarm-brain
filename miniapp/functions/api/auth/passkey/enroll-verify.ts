import {
  callPasskey,
  isSameOrigin,
  jsonResponse,
  type PasskeyEnv,
  requireSession,
  stepPassedResponse,
} from "../../../_lib/passkey-call";

// Cloudflare Pages Function: POST /api/auth/passkey/enroll-verify  { token, name?, credential }
// «Добавить устройство» (решение 17.10.2026): принимает ключ нового устройства по одноразовой ссылке.
// Ключ сохранён — второй шаг ЭТОЙ сессии засчитан: кука переиздаётся с меткой «шаг пройден» (как у
// /verify). Не прошло — кука не трогается, ссылка потрачена.
type Ctx = { request: Request; env: PasskeyEnv };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!isSameOrigin(request)) return jsonResponse({ error: "forbidden" }, 403);
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null) as { token?: unknown; name?: unknown; credential?: unknown } | null;
  if (typeof body?.token !== "string" || !body.credential) return jsonResponse({ ok: false, reason: "failed" }, 400);
  const r = await callPasskey(env, {
    op: "enroll_finish",
    telegram_id: session.claims.telegram_id,
    origin: new URL(request.url).origin,
    token: body.token,
    name: body.name,
    credential: body.credential,
  });
  if (r.body.ok !== true) return jsonResponse({ ok: false, reason: r.body.reason ?? "failed" }, r.status);
  return await stepPassedResponse(session, env, { ok: true });
}
