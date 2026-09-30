// state для Google OAuth на CF Pages: вход (flow=login) и подключение календаря (flow=calendar).
//
// Формат: b64url(JSON).HMAC. Подпись — на WEB_JWT_SECRET с префиксом STATE_DOMAIN, чтобы
// state не совпадал ни с одной другой подписью на этом ключе (сессия, auth-resolve, /link).
// state привязан к браузеру: в нём лежит одноразовое значение, которое start кладёт ещё и в
// httpOnly-куку OAUTH_NONCE_COOKIE; callback принимает state только при совпадении обоих.
// Обе ручки живут на одном домене pages.dev, поэтому кука первой стороны доезжает (SameSite=Lax
// пропускает верхнеуровневый GET-переход от Google).
const enc = new TextEncoder();

export const STATE_TTL_SEC = 600;
const STATE_DOMAIN = "oauth-state|";
export const OAUTH_NONCE_COOKIE = "roj_oauth";
// Путь куки — только ручки Google-OAuth: остальному API она не нужна.
const NONCE_COOKIE_PATH = "/api/auth/google";

export type OAuthFlow = "login" | "calendar";
export type OAuthState = { flow: OAuthFlow; next: string; tid: number | null };

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeText(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Защита от open-redirect: только относительный same-origin путь.
function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64url(bytes);
}

export async function signState(
  secret: string,
  s: { flow: OAuthFlow; next: string; nonce: string; tid?: number | null },
): Promise<string> {
  const payload = { f: s.flow, n: s.next, c: s.nonce, t: s.tid ?? null, iat: Math.floor(Date.now() / 1000) };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmacHex(secret, STATE_DOMAIN + body)}`;
}

// Возвращает разобранный state или null: битая подпись, истёк срок, нет куки или она не та.
export async function verifyState(
  secret: string,
  state: string,
  cookieNonce: string | null,
): Promise<OAuthState | null> {
  const parts = state.split(".");
  if (parts.length !== 2 || !cookieNonce) return null;
  const [body, sig] = parts;
  if (!timingSafeEq(await hmacHex(secret, STATE_DOMAIN + body), sig)) return null;
  let p: { f?: unknown; n?: unknown; c?: unknown; t?: unknown; iat?: unknown };
  try {
    p = JSON.parse(b64urlDecodeText(body));
  } catch {
    return null;
  }
  if (typeof p.iat !== "number" || Date.now() / 1000 - p.iat > STATE_TTL_SEC) return null;
  if (typeof p.c !== "string" || !timingSafeEq(p.c, cookieNonce)) return null;
  if (p.f === "login") return { flow: "login", next: safeNext(p.n), tid: null };
  if (p.f === "calendar" && typeof p.t === "number") return { flow: "calendar", next: safeNext(p.n), tid: p.t };
  return null;
}

export function readCookie(header: string | null, name: string): string | null {
  const m = (header ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

export function nonceCookie(nonce: string): string {
  return `${OAUTH_NONCE_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=${NONCE_COOKIE_PATH}; Max-Age=${STATE_TTL_SEC}`;
}
export function clearNonceCookie(): string {
  return `${OAUTH_NONCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=${NONCE_COOKIE_PATH}; Max-Age=0`;
}

// HMAC-подпись произвольной строки (для авторизации вызова auth-resolve по email).
export async function hmacSign(secret: string, data: string): Promise<string> {
  return hmacHex(secret, data);
}
