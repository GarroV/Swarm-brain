import { swarmApiUrl } from "../../_lib/api-url";
import { isProdHost } from "../../../src/lib/prodHosts";

// Cloudflare Pages Function: GET /api/auth/session?j=<веб-сессия>
// Вход на ВИТРИНУ (превью ветки) по готовой веб-сессии — ссылкой или QR-кодом, без вставки токена
// (владелец 17.10.2026: «нет web jwt или чето такое»). Сессию выпускает разработчик тем же ключом,
// что и прод, на несколько часов. Ключа подписи у превью нет, поэтому сессию проверяет сам прод:
// `/me` с ней в заголовке; пускаем, только если она принадлежит владельцу — как /api/auth/token.
// На боевом адресе маршрут закрыт.
type Env = { SWARM_API_URL?: string };
type Ctx = { request: Request; env: Env };

const OWNER_TELEGRAM_ID = 744230399; // тот же ADMIN_USER_ID, что в lib/supabase.ts
const SESSION_MAX_AGE = 6 * 3600;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const toLogin = (err: string) => new Response(null, { status: 302, headers: { Location: `/login?err=${err}` } });

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  if (isProdHost(url.hostname)) return new Response("Not found", { status: 404 });

  const jwt = url.searchParams.get("j") ?? "";
  if (!JWT_SHAPE.test(jwt)) return toLogin("token_login");

  const res = await fetch(`${swarmApiUrl(env)}/me`, { headers: { Authorization: `Bearer ${jwt}` } }).catch(() => null);
  const me = res && res.ok ? await res.json().catch(() => null) as { telegram_id?: number } | null : null;
  if (!me) return toLogin("token_login");
  if (Number(me.telegram_id) !== OWNER_TELEGRAM_ID) return toLogin("owner_only");

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      // Ссылка с сессией не должна оседать в истории дольше нужного: сразу уводим на «/».
      "Set-Cookie": `roj_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
