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

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
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

// ── Назначение токена ─────────────────────────────────────────────────────────
// Ключ WEB_JWT_SECRET общий для нескольких подписей, поэтому сессия несёт явную метку
// назначения (`pur`), и проверка сессии принимает только её. Любой другой токен, даже с
// верной подписью, сессией не считается.
export const SESSION_PURPOSE = "session";

// Токены старого формата (без `pur`) выпускались до 2026-09-30. Сессиями среди них были
// только долгие (7 и 30 дней); короткие сессиями не были. Поэтому старый формат принимаем,
// лишь пока до конца его срока больше этого запаса, а продление (прокси CF Pages) сразу
// переиздаёт его в новом формате — через 30 дней старых токенов не останется вовсе.
export const LEGACY_MIN_REMAINING_SEC = 600;

export type SessionClaims = {
  telegram_id: number;
  exp: number;
  // Момент входа (секунды). Продление его НЕ сдвигает — по нему работает «выйти везде».
  // У старого формата его нет: null.
  authTime: number | null;
  legacy: boolean;
};

export async function signJWT(
  payload: { telegram_id: number; auth_time?: number },
  secret: string,
  expSeconds = SESSION_TTL_SEC,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    telegram_id: payload.telegram_id,
    pur: SESSION_PURPOSE,
    auth_time: payload.auth_time ?? now,
    exp: now + expSeconds,
  };
  const data = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(body)))}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<SessionClaims | null> {
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
  let payload: { telegram_id?: number; exp?: number; pur?: unknown; auth_time?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  const nowSec = Date.now() / 1000;
  if (typeof payload.exp !== "number" || payload.exp < nowSec) return null;
  if (typeof payload.telegram_id !== "number") return null;
  const legacy = payload.pur === undefined;
  if (legacy) {
    if (payload.exp - nowSec <= LEGACY_MIN_REMAINING_SEC) return null;
  } else if (payload.pur !== SESSION_PURPOSE) {
    return null;
  }
  const authTime = !legacy && typeof payload.auth_time === "number" ? payload.auth_time : null;
  if (!legacy && authTime === null) return null;
  return { telegram_id: payload.telegram_id, exp: payload.exp, authTime, legacy };
}

// Момент входа для переиздания при продлении: у нового формата — как был, у старого —
// самая ранняя возможная оценка (exp − полный срок), она не позже настоящего входа.
export function authTimeForRefresh(claims: SessionClaims, ttl = SESSION_TTL_SEC): number {
  return claims.authTime ?? Math.min(claims.exp - ttl, Math.floor(Date.now() / 1000));
}

// Отозвана ли сессия: вход был раньше момента «выйти везде» (allowed_users.sessions_revoked_at).
// Непонятная отметка отзыва трактуется как отзыв — ошибаемся в сторону «войти заново».
export function isSessionRevoked(
  claims: Pick<SessionClaims, "authTime">,
  revokedAt: string | null | undefined,
): boolean {
  if (!revokedAt) return false;
  const revokedMs = Date.parse(revokedAt);
  if (Number.isNaN(revokedMs)) return true;
  if (claims.authTime === null) return true;
  return claims.authTime * 1000 < revokedMs;
}
