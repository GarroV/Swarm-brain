// state для Google-login (CF Pages): HMAC(next|iat) на WEB_JWT_SECRET — CSRF + возврат next.
// Своё, а не общий jwt.ts: полезная нагрузка (next) не лезет в типизированный {telegram_id}.
const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
}

export async function signState(secret: string, next: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const bodyStr = `${b64url(next)}.${iat}`;
  return `${bodyStr}.${await hmacHex(secret, bodyStr)}`;
}

// Возвращает { next } (только same-origin путь) или null. TTL 10 мин.
export async function verifyState(secret: string, state: string): Promise<{ next: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const bodyStr = `${parts[0]}.${parts[1]}`;
  if ((await hmacHex(secret, bodyStr)) !== parts[2]) return null;
  const iat = parseInt(parts[1], 10);
  if (!iat || Date.now() / 1000 - iat > 600) return null;
  let next = "/";
  try { next = b64urlDecode(parts[0]) || "/"; } catch { /* кривой next → "/" */ }
  // Защита от open-redirect: только относительный same-origin путь.
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";
  return { next };
}

// HMAC-подпись произвольной строки (для авторизации вызова auth-resolve по email).
export async function hmacSign(secret: string, data: string): Promise<string> {
  return hmacHex(secret, data);
}
