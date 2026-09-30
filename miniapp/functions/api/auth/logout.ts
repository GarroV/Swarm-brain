import { swarmApiUrl } from "../../_lib/api-url";
import { readCookie } from "../../_lib/oauth-state";

// Cloudflare Pages Function: POST /api/auth/logout — выход.
// 1) Просит swarm-api отозвать сессии человека (POST /auth/revoke-sessions): выход действует
//    на ВСЕ его устройства, а не только на этот браузер. Демо-сессию swarm-api не отзывает.
// 2) Гасит cookie. Две куки с одним именем живут раздельно: обычная и Partitioned (демо в
//    iframe витрины, см. auth/demo.ts). Гасим обе, иначе «Exit demo» внутри витрины ничего не делает.
// Сбой отзыва не мешает погасить cookie — человек в этом браузере выйдет в любом случае.
type Env = { SWARM_API_URL?: string };
type Ctx = { request: Request; env: Env };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const session = readCookie(request.headers.get("Cookie"), "roj_session");
  if (session) {
    const res = await fetch(`${swarmApiUrl(env)}/auth/revoke-sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}` },
    }).catch((e) => {
      console.error("logout: отзыв сессий не выполнен", e);
      return null;
    });
    // 401 — сессия уже недействительна, отзывать нечего.
    if (res && !res.ok && res.status !== 401) console.error("logout: отзыв сессий ответил", res.status);
  }
  const headers = new Headers();
  headers.append("Set-Cookie", "roj_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "roj_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0; Partitioned");
  return new Response(null, { status: 204, headers });
}
