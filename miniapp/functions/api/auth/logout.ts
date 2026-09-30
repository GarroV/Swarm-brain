// Cloudflare Pages Function: POST /api/auth/logout — гасит cookie сессии.
// Две куки с одним именем живут раздельно: обычная и Partitioned (демо в iframe витрины,
// см. auth/demo.ts). Гасим обе, иначе «Exit demo» внутри витрины ничего не делает.
type Ctx = { request: Request };

export async function onRequestPost(_ctx: Ctx): Promise<Response> {
  const headers = new Headers();
  headers.append("Set-Cookie", "roj_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "roj_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0; Partitioned");
  return new Response(null, { status: 204, headers });
}
