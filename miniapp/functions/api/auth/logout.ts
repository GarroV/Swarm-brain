// Cloudflare Pages Function: POST /api/auth/logout — гасит cookie сессии.
type Ctx = { request: Request };

export async function onRequestPost(_ctx: Ctx): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": "roj_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    },
  });
}
