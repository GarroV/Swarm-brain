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

// ── Срок веб-сессии ────────────────────────────────────────────────────────────
// Скользящее окно: прокси /api/* переиздаёт cookie, пока человек работает
// (miniapp/functions/api/[[path]].ts), поэтому активный пользователь не вылетает никогда,
// а брошенная сессия истекает сама через SESSION_TTL_SEC после ПОСЛЕДНЕГО запроса.
// До 2026-08-20 было жёстко 7 дней от момента входа без всякого продления — вылетал даже
// тот, кто заходил каждый день (issue #50).
export const SESSION_TTL_SEC = 30 * 86400;

// Переиздаём не на каждый запрос, а раз в сутки: экран дёргает /api десятки раз,
// Set-Cookie на каждый вызов — трафик и лишние заголовки без всякой пользы.
export const SESSION_REFRESH_AFTER_SEC = 86400;

// Пора ли переиздать cookie. `iat` в payload нет (исторически), поэтому момент выдачи
// восстанавливаем из exp и TTL. Токены, выданные со старым 7-дневным TTL, дают issuedAt
// в прошлом → переиздаются при первом же запросе, то есть старые сессии сами переезжают
// на новое окно, а не обрываются.
export function shouldRefreshSession(
  exp: number,
  nowSec: number,
  ttl = SESSION_TTL_SEC,
  after = SESSION_REFRESH_AFTER_SEC,
): boolean {
  return nowSec - (exp - ttl) > after;
}

export async function signJWT(
  payload: { telegram_id: number },
  secret: string,
  expSeconds = SESSION_TTL_SEC,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const body = { telegram_id: payload.telegram_id, exp: Math.floor(Date.now() / 1000) + expSeconds };
  const data = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(body)))}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<{ telegram_id: number; exp: number } | null> {
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
  return { telegram_id: payload.telegram_id, exp: payload.exp };
}
