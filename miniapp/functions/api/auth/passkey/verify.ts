import { SESSION_TTL_SEC, signJWT } from "../../../_lib/jwt";
import {
  authTimeForRefresh,
  callPasskey,
  isSameOrigin,
  jsonResponse,
  type PasskeyEnv,
  requireSession,
} from "../../../_lib/passkey-call";

// Cloudflare Pages Function: POST /api/auth/passkey/verify  { name?, credential }
// Принимает ответ браузера на вызов из /options. Прошёл шаг — переиздаёт куку roj_session с меткой
// «второй шаг пройден» (момент входа остаётся прежним, «выйти везде» работает как раньше).
// Не прошёл — кука не трогается: сессия остаётся «без второго шага», работа не блокируется (пока
// замок SECOND_STEP_REQUIRED в swarm-api выключен).
type Ctx = { request: Request; env: PasskeyEnv };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!isSameOrigin(request)) return jsonResponse({ error: "forbidden" }, 403);
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null) as { name?: unknown; credential?: unknown } | null;
  if (!body?.credential) return jsonResponse({ ok: false, reason: "failed" }, 400);
  const r = await callPasskey(env, {
    op: "finish",
    telegram_id: session.claims.telegram_id,
    origin: new URL(request.url).origin,
    name: body.name,
    credential: body.credential,
  });
  if (r.body.ok !== true) return jsonResponse({ ok: false, reason: r.body.reason ?? "failed" }, r.status);

  const jwt = await signJWT(
    {
      telegram_id: session.claims.telegram_id,
      auth_time: authTimeForRefresh(session.claims),
      second_step: true,
    },
    env.WEB_JWT_SECRET!,
  );
  const res = jsonResponse({ ok: true, mode: r.body.mode }, 200);
  res.headers.append("Set-Cookie", `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`);
  return res;
}
