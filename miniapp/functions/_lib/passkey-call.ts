// Общее для Pages Functions второго шага входа (ключ доступа, #955): кто звонит и как говорить с
// edge-функцией auth-passkey. Сессию человека проверяем ЗДЕСЬ (кука + живой GET /me), называем его
// telegram_id функции и подписываем вызов HMAC на WEB_JWT_SECRET — как у auth-resolve.
import { authTimeForRefresh, isRenewableSession, SESSION_TTL_SEC, type SessionClaims, signJWT, verifyJWT } from "./jwt";
import { functionsBase, swarmApiUrl } from "./api-url";
import { hmacSign, readCookie } from "./oauth-state";

export type PasskeyEnv = { WEB_JWT_SECRET?: string; SWARM_API_URL?: string };

export type PasskeySession = { claims: SessionClaims; token: string };

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
export const jsonResponse = json;

/** POST только со своей страницы: чужой сайт не должен дёргать окно ключа от имени вошедшего. */
export function isSameOrigin(request: Request): boolean {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

/**
 * Настоящая веб-сессия, к которой шаг применим: кука верна, это вход (а не короткий токен),
 * swarm-api её признаёт (отзыв, список допущенных) и сам говорит, что шаг применим (не демо).
 */
export async function requireSession(request: Request, env: PasskeyEnv): Promise<PasskeySession | Response> {
  if (!env.WEB_JWT_SECRET) return json({ error: "not configured" }, 500);
  const token = readCookie(request.headers.get("Cookie"), "roj_session");
  const claims = token ? await verifyJWT(token, env.WEB_JWT_SECRET) : null;
  if (!token || !claims) return json({ error: "unauthorized" }, 401);
  if (!isRenewableSession(claims)) return json({ error: "not_applicable" }, 403);
  const me = await fetch(`${swarmApiUrl(env)}/me`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!me) return json({ error: "upstream" }, 502);
  if (me.status === 401 || me.status === 403) return json({ error: "unauthorized" }, 401);
  const body = me.ok ? (await me.json().catch(() => null)) as { second_step?: { applies?: boolean } } | null : null;
  if (!body) return json({ error: "upstream" }, 502);
  if (body.second_step?.applies !== true) return json({ error: "not_applicable" }, 403);
  return { claims, token };
}

/** Вызов auth-passkey. Ответ функции отдаётся как есть, сеть недоступна — 502. */
export async function callPasskey(
  env: PasskeyEnv,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify({ ts: Date.now(), ...payload });
  const sig = await hmacSign(env.WEB_JWT_SECRET ?? "", raw);
  const res = await fetch(`${functionsBase(env)}/auth-passkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sig": sig },
    body: raw,
  }).catch((e) => {
    console.error("auth-passkey недоступен", e);
    return null;
  });
  if (!res) return { status: 502, body: { ok: false, reason: "upstream" } };
  const body = await res.json().catch(() => ({ ok: false })) as Record<string, unknown>;
  return { status: res.status, body };
}

/** Кука сессии с отметкой «второй шаг пройден»: момент входа остаётся прежним. */
export { authTimeForRefresh };

/**
 * Шаг пройден: ответ `body` с переизданной кукой roj_session того же человека — момент входа прежний
 * («выйти везде» работает как раньше), метка `sf` стоит.
 */
export async function stepPassedResponse(session: PasskeySession, env: PasskeyEnv, body: unknown): Promise<Response> {
  const jwt = await signJWT(
    {
      telegram_id: session.claims.telegram_id,
      auth_time: authTimeForRefresh(session.claims),
      second_step: true,
    },
    env.WEB_JWT_SECRET!,
  );
  const res = json(body, 200);
  res.headers.append("Set-Cookie", `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`);
  return res;
}
