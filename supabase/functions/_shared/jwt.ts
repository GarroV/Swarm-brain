// HS256 JWT для веб-сессий (Telegram Login Widget, вариант B+).
// Web Crypto — работает и в Deno (edge functions), и в Cloudflare Pages Functions.
// ВАЖНО: при правке синхронизировать с копией miniapp/functions/_lib/jwt.ts.

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? 4 - (norm.length % 4) : 0;
  const bin = atob(norm + "=".repeat(pad));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

export async function signJWT(
  payload: { telegram_id: number },
  secret: string,
  expSeconds = 7 * 86400,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const body = { telegram_id: payload.telegram_id, exp: Math.floor(Date.now() / 1000) + expSeconds };
  const data = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(body)))}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<{ telegram_id: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const key = await hmacKey(secret);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify("HMAC", key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload: { telegram_id?: number; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now() / 1000) return null;
  if (typeof payload.telegram_id !== "number") return null;
  return { telegram_id: payload.telegram_id };
}
