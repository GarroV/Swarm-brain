import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authTimeForRefresh,
  isSessionRevoked,
  LEGACY_MIN_REMAINING_SEC,
  SESSION_REFRESH_AFTER_SEC,
  SESSION_TTL_SEC,
  shouldRefreshSession,
  signJWT,
  verifyJWT,
} from "./jwt.ts";

const SECRET = "test-secret-0123456789";

Deno.test("signJWT → verifyJWT round-trip возвращает telegram_id и exp", async () => {
  const before = Math.floor(Date.now() / 1000);
  const token = await signJWT({ telegram_id: 744230399 }, SECRET);
  const v = await verifyJWT(token, SECRET);
  assertEquals(v?.telegram_id, 744230399);
  // exp ставится от «сейчас» на полный срок сессии — с запасом на секунду выполнения.
  assertEquals(v!.exp >= before + SESSION_TTL_SEC, true);
  assertEquals(v!.exp <= before + SESSION_TTL_SEC + 5, true);
});

Deno.test("verifyJWT отклоняет подделанную подпись", async () => {
  const token = await signJWT({ telegram_id: 1 }, SECRET);
  const tampered = token.slice(0, -3) + "AAA";
  assertEquals(await verifyJWT(tampered, SECRET), null);
});

Deno.test("verifyJWT отклоняет чужой секрет", async () => {
  const token = await signJWT({ telegram_id: 1 }, SECRET);
  assertEquals(await verifyJWT(token, "other-secret"), null);
});

Deno.test("verifyJWT отклоняет протухший токен", async () => {
  const token = await signJWT({ telegram_id: 1 }, SECRET, -10); // exp в прошлом
  assertEquals(await verifyJWT(token, SECRET), null);
});

Deno.test("verifyJWT отклоняет мусор", async () => {
  assertEquals(await verifyJWT("not.a.jwt", SECRET), null);
  assertEquals(await verifyJWT("", SECRET), null);
});

// ── Продление сессии (issue #50) ───────────────────────────────────────────────
// Раньше сессия жила 7 дней от входа и не продлевалась ничем: тот, кто заходил каждый
// день, всё равно вылетал раз в неделю. Теперь окно скользит, пока человек работает.

const NOW = 1_800_000_000;

Deno.test("shouldRefreshSession: свежую cookie не переиздаём", () => {
  const exp = NOW + SESSION_TTL_SEC; // только что выдана
  assertEquals(shouldRefreshSession(exp, NOW), false);
});

Deno.test("shouldRefreshSession: за минуту до порога — ещё нет, после — да", () => {
  const justUnder = NOW + SESSION_TTL_SEC - SESSION_REFRESH_AFTER_SEC + 60;
  const justOver = NOW + SESSION_TTL_SEC - SESSION_REFRESH_AFTER_SEC - 60;
  assertEquals(shouldRefreshSession(justUnder, NOW), false);
  assertEquals(shouldRefreshSession(justOver, NOW), true);
});

Deno.test("shouldRefreshSession: cookie старше суток переиздаём", () => {
  const exp = NOW + SESSION_TTL_SEC - 2 * 86400; // выдана два дня назад
  assertEquals(shouldRefreshSession(exp, NOW), true);
});

Deno.test("shouldRefreshSession: старая 7-дневная сессия переезжает на новое окно, а не обрывается", () => {
  // Токен, подписанный до перехода на 30 дней: exp близко, issuedAt по новой формуле
  // уезжает в прошлое — значит переиздаём при первом же запросе.
  const legacyExp = NOW + 7 * 86400;
  assertEquals(shouldRefreshSession(legacyExp, NOW), true);
});

Deno.test("shouldRefreshSession: срок сессии — 30 дней", () => {
  assertEquals(SESSION_TTL_SEC, 30 * 86400);
  assertEquals(SESSION_REFRESH_AFTER_SEC, 86400);
});

// ── Назначение токена и отзыв сессий ───────────────────────────────────────────
// Подписываем произвольное тело тем же ключом — так выглядит любой не-сессионный токен.
async function signRaw(body: Record<string, unknown>, secret = SECRET): Promise<string> {
  const e = new TextEncoder();
  const b64 = (u: Uint8Array) =>
    btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const data = `${b64(e.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))}.${b64(e.encode(JSON.stringify(body)))}`;
  const key = await crypto.subtle.importKey("raw", e.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return `${data}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, e.encode(data))))}`;
}
const nowSec = () => Math.floor(Date.now() / 1000);

Deno.test("signJWT ставит метку сессии и момент входа", async () => {
  const v = await verifyJWT(await signJWT({ telegram_id: 5 }, SECRET), SECRET);
  assertEquals(v?.legacy, false);
  assertEquals(typeof v?.authTime, "number");
});

Deno.test("verifyJWT: токен с чужим назначением сессией не считается", async () => {
  const t = await signRaw({ telegram_id: 5, pur: "oauth_state", auth_time: nowSec(), exp: nowSec() + 3600 });
  assertEquals(await verifyJWT(t, SECRET), null);
});

Deno.test("verifyJWT: сессия нового формата без момента входа отклоняется", async () => {
  const t = await signRaw({ telegram_id: 5, pur: "session", exp: nowSec() + 3600 });
  assertEquals(await verifyJWT(t, SECRET), null);
});

Deno.test("verifyJWT: короткий токен старого формата отклоняется", async () => {
  const t = await signRaw({ telegram_id: 5, exp: nowSec() + LEGACY_MIN_REMAINING_SEC - 5 });
  assertEquals(await verifyJWT(t, SECRET), null);
});

Deno.test("verifyJWT: долгая сессия старого формата принимается как legacy", async () => {
  const t = await signRaw({ telegram_id: 5, exp: nowSec() + 7 * 86400 });
  const v = await verifyJWT(t, SECRET);
  assertEquals(v?.telegram_id, 5);
  assertEquals(v?.legacy, true);
  assertEquals(v?.authTime, null);
});

Deno.test("authTimeForRefresh: продление не сдвигает момент входа", async () => {
  const t = await signJWT({ telegram_id: 5, auth_time: 1_700_000_000 }, SECRET);
  const v = (await verifyJWT(t, SECRET))!;
  assertEquals(authTimeForRefresh(v), 1_700_000_000);
  const legacy = { telegram_id: 5, exp: nowSec() + 7 * 86400, authTime: null, legacy: true };
  assertEquals(authTimeForRefresh(legacy) <= nowSec() + 7 * 86400 - SESSION_TTL_SEC, true);
});

Deno.test("isSessionRevoked: вход раньше отзыва — отозвана, позже — жива", () => {
  const revokedAt = new Date(1_750_000_000_000).toISOString();
  assertEquals(isSessionRevoked({ authTime: 1_749_999_000 }, revokedAt), true);
  assertEquals(isSessionRevoked({ authTime: 1_750_000_100 }, revokedAt), false);
});

Deno.test("isSessionRevoked: без отзыва жива; старый формат после отзыва — отозван", () => {
  assertEquals(isSessionRevoked({ authTime: 1 }, null), false);
  assertEquals(isSessionRevoked({ authTime: null }, null), false);
  assertEquals(isSessionRevoked({ authTime: null }, "2026-10-01T00:00:00Z"), true);
});

Deno.test("isSessionRevoked: нечитаемая отметка отзыва — считаем отозванной", () => {
  assertEquals(isSessionRevoked({ authTime: 9_999_999_999 }, "not-a-date"), true);
});
