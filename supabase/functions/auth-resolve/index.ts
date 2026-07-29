// auth-resolve — server-to-server резолв verified email → личность (для CF google-login).
// Аутентификация ВЫЗОВА (не пользователя): HMAC(email) на WEB_JWT_SECRET, общий с CF Pages.
// Возвращает allowed_users по email (lower). Деплой: supabase functions deploy auth-resolve --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WEB_JWT_SECRET = Deno.env.get("WEB_JWT_SECRET") ?? "";
const enc = new TextEncoder();

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(WEB_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!WEB_JWT_SECRET) return json({ error: "not configured" }, 500);
  let body: { email?: string; sig?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const email = (body.email ?? "").toLowerCase().trim();
  const sig = body.sig ?? "";
  if (!email || !sig) return json({ error: "bad request" }, 400);
  // Доказательство владения WEB_JWT_SECRET, привязанное к конкретному email.
  if (!timingSafeEq(sig, await hmacHex(email))) return json({ error: "forbidden" }, 403);

  // email хранится в lower (бэкфилл + запись админкой); уникальный индекс по lower(email).
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id, telegram_id, group_id")
    .eq("email", email)
    .maybeSingle();
  if (error) return json({ error: "db" }, 500);
  if (!data) return json({ found: false });
  const row = data as { id: number; telegram_id: number | null; group_id: string | null };
  return json({ found: true, id: row.id, telegram_id: row.telegram_id, group_id: row.group_id });
});
