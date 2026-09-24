import { functionsBase, PROD_HOST } from "../../_lib/api-url";

// Cloudflare Pages Function: POST /api/auth/token (форма: token=<личный smcp_-токен>)
// Вход на ВИТРИНУ (превью ветки) — ТОЛЬКО для владельца. Google и Telegram на превью не работают
// (адрес не прописан ни в Google, ни у бота), а ключа подписи сессий WEB_JWT_SECRET у превью нет:
// Cloudflare и Supabase хранят его «только на запись». Поэтому сессию выпускает сам прод —
// meeting-webtoken меняет личный токен на ту же веб-сессию, что в куке roj_session (так входит
// рекордер), — а здесь пропускаем её, только если она принадлежит владельцу. Токен коллеги,
// даже настоящий, получает отказ. На боевом адресе маршрут закрыт.
// Решение владельца 24.09.2026: «давай жестко как-то привяжем только ко мне».
type Env = { SWARM_API_URL?: string };
type Ctx = { request: Request; env: Env };

const OWNER_TELEGRAM_ID = 744230399; // тот же ADMIN_USER_ID, что в lib/supabase.ts
const SESSION_MAX_AGE = 7 * 86400;   // как у meeting-webtoken (signJWT по умолчанию)

const toLogin = (err: string) => new Response(null, { status: 302, headers: { Location: `/login?err=${err}` } });

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (new URL(request.url).hostname === PROD_HOST) return new Response("Not found", { status: 404 });

  const form = await request.formData().catch(() => null);
  const token = String(form?.get("token") ?? "").trim();
  if (!token) return toLogin("token_login");

  const res = await fetch(`${functionsBase(env)}/meeting-webtoken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  const body = res && res.ok
    ? await res.json().catch(() => null) as { ok?: boolean; jwt?: string; telegram_id?: number } | null
    : null;
  if (!body?.ok || !body.jwt) return toLogin("token_login");
  if (Number(body.telegram_id) !== OWNER_TELEGRAM_ID) return toLogin("owner_only");

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `roj_session=${body.jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`,
    },
  });
}
